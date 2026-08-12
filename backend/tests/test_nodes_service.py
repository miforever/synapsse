import aiosqlite

from app.memories.edges import create_edge, list_edges_for_node, traverse_graph
from app.memories.models import EdgeCreate, NodeCreate
from app.memories.nodes import create_node, get_node
from app.search.service import search


async def test_create_and_get_node(conn: aiosqlite.Connection) -> None:
    node = await create_node(
        conn,
        NodeCreate(type="idea", title="Test Idea", summary="A short summary"),
    )
    fetched = await get_node(conn, node.id)
    assert fetched is not None
    assert fetched.title == "Test Idea"
    assert fetched.type == "idea"


async def test_search_index_finds_node(conn: aiosqlite.Connection) -> None:
    await create_node(
        conn,
        NodeCreate(
            type="project",
            title="Synapsse Daemon",
            summary="Local-first memory graph",
            content="Runs on aiosqlite with FTS5 search",
        ),
    )
    results = await search(conn, "aiosqlite", mode="keyword")
    assert len(results) == 1
    assert results[0].title == "Synapsse Daemon"


async def test_create_edge_and_traverse(conn: aiosqlite.Connection) -> None:
    a = await create_node(conn, NodeCreate(type="idea", title="A", summary="Node A"))
    b = await create_node(conn, NodeCreate(type="idea", title="B", summary="Node B"))
    await create_edge(
        conn, EdgeCreate(source_id=a.id, target_id=b.id, relation_type="relates_to")
    )

    a_edges = await list_edges_for_node(conn, a.id)
    assert len(a_edges) == 1

    reachable = await traverse_graph(conn, a.id, depth=1)
    assert reachable[a.id] == [b.id]


async def test_edge_cascade_delete_on_node_removal(conn: aiosqlite.Connection) -> None:
    a = await create_node(conn, NodeCreate(type="idea", title="A", summary="Node A"))
    b = await create_node(conn, NodeCreate(type="idea", title="B", summary="Node B"))
    await create_edge(
        conn, EdgeCreate(source_id=a.id, target_id=b.id, relation_type="relates_to")
    )

    await conn.execute("DELETE FROM nodes WHERE id = ?", (a.id,))
    await conn.commit()

    remaining = await list_edges_for_node(conn, b.id)
    assert remaining == []


async def test_traverse_walks_outward_one_ring_per_hop(
    conn: aiosqlite.Connection,
) -> None:
    """A chain a-b-c-d: depth 2 reaches c and stops before d."""
    chain = [
        await create_node(conn, NodeCreate(type="idea", title=name, summary="s"))
        for name in ("a", "b", "c", "d")
    ]
    for left, right in zip(chain, chain[1:], strict=False):
        await create_edge(
            conn,
            EdgeCreate(
                source_id=left.id, target_id=right.id, relation_type="relates_to"
            ),
        )

    reached = await traverse_graph(conn, chain[0].id, depth=2)

    assert set(reached) == {chain[0].id, chain[1].id}
    assert reached[chain[0].id] == [chain[1].id]
    assert set(reached[chain[1].id]) == {chain[0].id, chain[2].id}
    # d is one hop too far to be named at all.
    assert chain[3].id not in {n for ns in reached.values() for n in ns}


async def test_traverse_follows_edges_from_either_end(
    conn: aiosqlite.Connection,
) -> None:
    """Direction is a property of the relationship, not of who can see it."""
    middle = await create_node(conn, NodeCreate(type="idea", title="m", summary="s"))
    inbound = await create_node(conn, NodeCreate(type="idea", title="i", summary="s"))
    outbound = await create_node(conn, NodeCreate(type="idea", title="o", summary="s"))

    await create_edge(
        conn,
        EdgeCreate(
            source_id=inbound.id, target_id=middle.id, relation_type="relates_to"
        ),
    )
    await create_edge(
        conn,
        EdgeCreate(
            source_id=middle.id, target_id=outbound.id, relation_type="relates_to"
        ),
    )

    reached = await traverse_graph(conn, middle.id, depth=1)
    assert set(reached[middle.id]) == {inbound.id, outbound.id}


async def test_traverse_terminates_on_a_cycle(conn: aiosqlite.Connection) -> None:
    """A ring must not walk forever, however deep it is asked to go."""
    ring = [
        await create_node(conn, NodeCreate(type="idea", title=name, summary="s"))
        for name in ("x", "y", "z")
    ]
    for left, right in zip(ring, ring[1:] + ring[:1], strict=False):
        await create_edge(
            conn,
            EdgeCreate(
                source_id=left.id, target_id=right.id, relation_type="relates_to"
            ),
        )

    reached = await traverse_graph(conn, ring[0].id, depth=10)
    assert set(reached) == {node.id for node in ring}


async def test_traverse_of_an_unconnected_memory_is_just_itself(
    conn: aiosqlite.Connection,
) -> None:
    alone = await create_node(conn, NodeCreate(type="idea", title="alone", summary="s"))
    assert await traverse_graph(conn, alone.id, depth=3) == {alone.id: []}
