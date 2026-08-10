import aiosqlite

from app.core.identifiers import new_id, utcnow_iso
from app.core.queries import fetch_all, fetch_one, row_to_dict
from app.memories.models import EdgeCreate, EdgeOut

_INSERT = """
INSERT INTO edges (id, source_id, target_id, relation_type, weight, created_at)
VALUES (?, ?, ?, ?, ?, ?)
"""
_BY_ID = "SELECT * FROM edges WHERE id = ?"
_FOR_NODE = "SELECT * FROM edges WHERE source_id = ? OR target_id = ?"


def _to_edge(row: aiosqlite.Row) -> EdgeOut:
    return EdgeOut.model_validate(row_to_dict(row))


async def create_edge(conn: aiosqlite.Connection, data: EdgeCreate) -> EdgeOut:
    edge_id = new_id()
    await conn.execute(
        _INSERT,
        (
            edge_id,
            data.source_id,
            data.target_id,
            data.relation_type,
            data.weight,
            utcnow_iso(),
        ),
    )
    await conn.commit()

    row = await fetch_one(conn, _BY_ID, (edge_id,))
    assert row is not None
    return _to_edge(row)


async def list_edges_for_node(
    conn: aiosqlite.Connection, node_id: str
) -> list[EdgeOut]:
    rows = await fetch_all(conn, _FOR_NODE, (node_id, node_id))
    return [_to_edge(row) for row in rows]


async def delete_between(
    conn: aiosqlite.Connection, source_id: str, target_id: str, relation_type: str
) -> int:
    """Remove the edges joining two memories, in either direction.

    Both directions, because "these two are no longer connected" is what a
    caller means, and asking them to know which end was written first is
    asking them to remember something the graph never showed them.
    """
    cursor = await conn.execute(
        "DELETE FROM edges WHERE relation_type = ? AND "
        "((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?))",
        (relation_type, source_id, target_id, target_id, source_id),
    )
    await conn.commit()
    return cursor.rowcount


async def delete_edge(conn: aiosqlite.Connection, edge_id: str) -> bool:
    cursor = await conn.execute("DELETE FROM edges WHERE id = ?", (edge_id,))
    await conn.commit()
    return cursor.rowcount > 0


async def traverse_graph(
    conn: aiosqlite.Connection, node_id: str, depth: int = 1
) -> dict[str, list[str]]:
    """Return {node_id: [neighbor_ids]} for nodes reachable within `depth` hops.

    One query per hop rather than one per node. The frontier grows with the
    graph's branching factor, so asking per node meant a round trip for every
    memory reached — measured at 280 of them for a three-hop walk — where the
    whole ring can be fetched in a single statement.
    """
    frontier = {node_id}
    visited: dict[str, list[str]] = {}

    for _ in range(max(depth, 0)):
        if not frontier:
            break

        for current, neighbours in (await _neighbours_of(conn, frontier)).items():
            visited[current] = neighbours

        # Nodes named as neighbours but not yet expanded. Dead ends leave no
        # entry of their own, so they are recorded as reached with nothing
        # beyond them rather than being asked about again next hop.
        for reached in frontier:
            visited.setdefault(reached, [])

        frontier = {
            neighbour for neighbours in visited.values() for neighbour in neighbours
        } - visited.keys()

    return visited


async def find_path(
    conn: aiosqlite.Connection, source_id: str, target_id: str, max_depth: int = 6
) -> list[str]:
    """The shortest chain of memories linking two nodes, source first.

    Breadth-first, so the first route found is the shortest one, and expanded a
    whole hop per query the way traverse_graph is — a path of six across a
    branching graph is thousands of nodes, and asking about each one separately
    would cost a round trip apiece.

    Edges are followed in both directions. `depends_on` points one way, but "how
    are these two connected" is a question about the graph's shape rather than
    about which end was written first, and a search that only ran downstream
    would miss the answer most of the time.

    Returns [] when nothing links them within `max_depth`, which is not the same
    as no relationship existing — only that none is this short.
    """
    if source_id == target_id:
        return [source_id]

    # Where each node was first reached from, which is also the visited set.
    came_from: dict[str, str] = {}
    frontier = {source_id}

    for _ in range(max(max_depth, 0)):
        if not frontier:
            break

        reached: set[str] = set()
        for current, neighbours in (await _neighbours_of(conn, frontier)).items():
            for neighbour in neighbours:
                if neighbour == source_id or neighbour in came_from:
                    continue
                came_from[neighbour] = current
                if neighbour == target_id:
                    return _rebuild_path(came_from, source_id, target_id)
                reached.add(neighbour)

        frontier = reached

    return []


def _rebuild_path(
    came_from: dict[str, str], source_id: str, target_id: str
) -> list[str]:
    """Walk the breadcrumbs back to the source, then read them forwards."""
    path = [target_id]
    while path[-1] != source_id:
        path.append(came_from[path[-1]])
    return list(reversed(path))


async def edges_between(
    conn: aiosqlite.Connection, node_ids: list[str]
) -> list[EdgeOut]:
    """Every edge with both ends inside `node_ids`."""
    if not node_ids:
        return []

    placeholders = ",".join("?" for _ in node_ids)
    rows = await fetch_all(
        conn,
        # noqa: S608 — placeholders are generated, never interpolated values.
        f"SELECT * FROM edges "  # noqa: S608
        f"WHERE source_id IN ({placeholders}) AND target_id IN ({placeholders})",
        (*node_ids, *node_ids),
    )
    return [_to_edge(row) for row in rows]


async def _neighbours_of(
    conn: aiosqlite.Connection, node_ids: set[str]
) -> dict[str, list[str]]:
    """Every edge touching any of `node_ids`, grouped by which one it touches.

    An edge between two members of the frontier belongs to both, which is why
    each row is examined from both ends rather than assigned to one.
    """
    placeholders = ",".join("?" for _ in node_ids)
    rows = await fetch_all(
        conn,
        # noqa: S608 — placeholders are generated, never interpolated values.
        f"SELECT source_id, target_id FROM edges "  # noqa: S608
        f"WHERE source_id IN ({placeholders}) OR target_id IN ({placeholders})",
        (*node_ids, *node_ids),
    )

    grouped: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    for row in rows:
        source, target = row["source_id"], row["target_id"]
        if source in grouped:
            grouped[source].append(target)
        if target in grouped:
            grouped[target].append(source)
    return grouped
