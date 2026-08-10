import aiosqlite

from app.canvas.graph import get_snapshot
from app.memories.edges import create_edge
from app.memories.models import EdgeCreate, NodeCreate
from app.memories.nodes import create_node


async def test_snapshot_is_empty_initially(conn: aiosqlite.Connection) -> None:
    snapshot = await get_snapshot(conn)
    assert snapshot.nodes == []
    assert snapshot.edges == []


async def test_snapshot_projects_nodes_and_links(conn: aiosqlite.Connection) -> None:
    a = await create_node(
        conn, NodeCreate(type="idea", title="A", summary="s", tags=["x", "y"])
    )
    b = await create_node(conn, NodeCreate(type="finding", title="B", summary="s"))
    await create_edge(
        conn,
        EdgeCreate(source_id=a.id, target_id=b.id, relation_type="depends_on"),
    )

    snapshot = await get_snapshot(conn)

    assert {n.id for n in snapshot.nodes} == {a.id, b.id}
    assert len(snapshot.edges) == 1
    # Link fields use source/target so the renderer needs no transform pass.
    assert snapshot.edges[0].source == a.id
    assert snapshot.edges[0].target == b.id


async def test_snapshot_includes_tags(conn: aiosqlite.Connection) -> None:
    await create_node(
        conn, NodeCreate(type="idea", title="A", summary="s", tags=["alpha", "beta"])
    )
    snapshot = await get_snapshot(conn)
    assert sorted(snapshot.nodes[0].tags) == ["alpha", "beta"]


async def test_untagged_node_has_empty_tags(conn: aiosqlite.Connection) -> None:
    await create_node(conn, NodeCreate(type="idea", title="A", summary="s"))
    snapshot = await get_snapshot(conn)
    assert snapshot.nodes[0].tags == []


async def test_snapshot_omits_markdown_content(conn: aiosqlite.Connection) -> None:
    """The canvas payload must stay light; content is fetched on open."""
    await create_node(
        conn,
        NodeCreate(type="idea", title="A", summary="s", content="# heavy markdown"),
    )
    snapshot = await get_snapshot(conn)
    assert not hasattr(snapshot.nodes[0], "content")
