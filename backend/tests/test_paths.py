"""How two memories are connected — the walk, and what it reports."""

import aiosqlite
import pytest

from app.memories.edges import create_edge, find_path
from app.memories.models import EdgeCreate, NodeCreate
from app.memories.nodes import create_node
from app.memories.paths import path_between


async def _node(conn: aiosqlite.Connection, title: str) -> str:
    node = await create_node(
        conn, NodeCreate(type="idea", title=title, summary=f"about {title}")
    )
    return node.id


async def _link(
    conn: aiosqlite.Connection,
    source: str,
    target: str,
    relation: str = "relates_to",
    weight: float = 1.0,
) -> str:
    edge = await create_edge(
        conn,
        EdgeCreate(
            source_id=source,
            target_id=target,
            relation_type=relation,  # type: ignore[arg-type]
            weight=weight,
        ),
    )
    return edge.id


@pytest.fixture
async def chain(conn: aiosqlite.Connection) -> tuple[aiosqlite.Connection, list[str]]:
    """A --- B --- C --- D, plus an unattached E."""
    ids = [await _node(conn, name) for name in ("A", "B", "C", "D", "E")]
    for first, second in zip(ids, ids[1:4], strict=False):
        await _link(conn, first, second)
    return conn, ids


async def test_finds_the_chain(
    chain: tuple[aiosqlite.Connection, list[str]],
) -> None:
    conn, ids = chain
    path = await path_between(conn, ids[0], ids[3])

    assert [node.title for node in path.nodes] == ["A", "B", "C", "D"]
    assert len(path.edges) == 3


async def test_shortest_wins_over_the_long_way(
    chain: tuple[aiosqlite.Connection, list[str]],
) -> None:
    """A shortcut added later must be the answer, not the original chain."""
    conn, ids = chain
    await _link(conn, ids[0], ids[3], "depends_on")

    path = await path_between(conn, ids[0], ids[3])
    assert [node.title for node in path.nodes] == ["A", "D"]
    assert path.edges[0].relation_type == "depends_on"


async def test_follows_edges_backwards(conn: aiosqlite.Connection) -> None:
    """Direction is about authorship, not about whether two things are linked."""
    first, second = await _node(conn, "First"), await _node(conn, "Second")
    await _link(conn, second, first, "depends_on")

    path = await path_between(conn, first, second)
    assert [node.title for node in path.nodes] == ["First", "Second"]


async def test_unreachable_is_empty_not_an_error(
    chain: tuple[aiosqlite.Connection, list[str]],
) -> None:
    conn, ids = chain
    path = await path_between(conn, ids[0], ids[4])
    assert path.nodes == [] and path.edges == []


async def test_depth_limit_is_respected(
    chain: tuple[aiosqlite.Connection, list[str]],
) -> None:
    conn, ids = chain
    assert await find_path(conn, ids[0], ids[3], max_depth=2) == []
    assert await find_path(conn, ids[0], ids[3], max_depth=3) != []


async def test_node_to_itself(chain: tuple[aiosqlite.Connection, list[str]]) -> None:
    conn, ids = chain
    path = await path_between(conn, ids[0], ids[0])
    assert [node.title for node in path.nodes] == ["A"]
    assert path.edges == []


async def test_missing_node_finds_nothing(
    chain: tuple[aiosqlite.Connection, list[str]],
) -> None:
    conn, ids = chain
    assert (await path_between(conn, ids[0], "no-such-node")).nodes == []


async def test_heaviest_edge_describes_the_hop(conn: aiosqlite.Connection) -> None:
    """Two memories joined twice are described by the link that matters most."""
    first, second = await _node(conn, "First"), await _node(conn, "Second")
    await _link(conn, first, second, "relates_to", weight=0.2)
    await _link(conn, first, second, "depends_on", weight=0.9)

    path = await path_between(conn, first, second)
    assert len(path.edges) == 1
    assert path.edges[0].relation_type == "depends_on"
