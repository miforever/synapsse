"""How two memories are connected.

search_index answers "which memory is about this" and traverse_graph answers
"what is near this one". Neither answers the question you ask once the store
has grown: what links these two — the decision and the issue, the person and
the project — when nothing says so directly.

The walk itself is in `edges`; this puts titles on it, so the caller reads a
chain of memories rather than a list of identifiers it has to fetch one by one.
"""

import aiosqlite

from app.memories import edges as edges_service
from app.memories import nodes as nodes_service
from app.memories.models import EdgeOut, PathOut

# A path longer than this is not an explanation of anything. Six hops through a
# well-linked memory graph already reaches most of it, and the cost of the walk
# grows with the branching factor at every one.
MAX_DEPTH = 12
DEFAULT_DEPTH = 6


async def path_between(
    conn: aiosqlite.Connection,
    source_id: str,
    target_id: str,
    max_depth: int = DEFAULT_DEPTH,
) -> PathOut:
    """The shortest route between two memories, as nodes and the edges joining.

    An empty path means no route within `max_depth` — including the case where
    one of the two does not exist, which the caller is expected to have checked
    if it wants to tell the difference.
    """
    walked = await edges_service.find_path(
        conn, source_id, target_id, min(max_depth, MAX_DEPTH)
    )
    if not walked:
        return PathOut()

    summaries = await nodes_service.summaries_for(conn, walked)
    if any(node_id not in summaries for node_id in walked):
        # Only reachable if a node was deleted between the walk and this read.
        return PathOut()

    return PathOut(
        nodes=[summaries[node_id] for node_id in walked],
        edges=await _joining_edges(conn, walked),
    )


async def _joining_edges(
    conn: aiosqlite.Connection, walked: list[str]
) -> list[EdgeOut]:
    """One edge per consecutive pair, in the order they are walked.

    Two memories can be joined more than once — a `relates_to` written early
    and a `depends_on` added later. The heaviest wins, that being the one the
    graph itself says matters most; ties go to whichever was written first, so
    the same path does not describe itself differently between reads.
    """
    candidates = await edges_service.edges_between(conn, walked)

    by_pair: dict[frozenset[str], EdgeOut] = {}
    for edge in sorted(candidates, key=lambda e: (-e.weight, e.created_at)):
        by_pair.setdefault(frozenset((edge.source_id, edge.target_id)), edge)

    return [
        by_pair[pair]
        for first, second in zip(walked, walked[1:], strict=False)
        if (pair := frozenset((first, second))) in by_pair
    ]
