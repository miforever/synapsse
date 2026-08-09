"""Editing and removing memories — a store you cannot correct is a liability."""

import aiosqlite

from app.canvas.graph import get_snapshot
from app.memories.edges import create_edge, delete_edge, list_edges_for_node
from app.memories.models import EdgeCreate, NodeCreate, NodeUpdate
from app.memories.nodes import create_node, delete_node, get_node, update_node
from app.memories.tags import list_tags
from app.memories.types import list_types


async def test_update_changes_only_given_fields(conn: aiosqlite.Connection) -> None:
    node = await create_node(
        conn,
        NodeCreate(type="idea", title="Original", summary="Keep me", content="Body"),
    )
    updated = await update_node(conn, node.id, NodeUpdate(title="Renamed"))

    assert updated is not None
    assert updated.title == "Renamed"
    assert updated.summary == "Keep me"
    assert updated.content == "Body"


async def test_update_refreshes_search_index(conn: aiosqlite.Connection) -> None:
    """The FTS triggers must follow edits, or search returns stale titles."""
    from app.search.service import search

    node = await create_node(
        conn, NodeCreate(type="idea", title="Aardvark", summary="s")
    )
    await update_node(conn, node.id, NodeUpdate(title="Zeppelin"))

    assert await search(conn, "Aardvark", mode="keyword") == []
    assert [r.title for r in await search(conn, "Zeppelin", mode="keyword")] == [
        "Zeppelin"
    ]


async def test_update_bumps_updated_at(conn: aiosqlite.Connection) -> None:
    node = await create_node(conn, NodeCreate(type="idea", title="A", summary="s"))
    updated = await update_node(conn, node.id, NodeUpdate(title="B"))
    assert updated is not None
    assert updated.updated_at >= node.updated_at


async def test_update_registers_new_class(conn: aiosqlite.Connection) -> None:
    node = await create_node(conn, NodeCreate(type="idea", title="A", summary="s"))
    await update_node(conn, node.id, NodeUpdate(type="Retrospective"))

    assert "retrospective" in await list_types(conn)


async def test_omitted_tags_are_preserved(conn: aiosqlite.Connection) -> None:
    node = await create_node(
        conn, NodeCreate(type="idea", title="A", summary="s", tags=["keep"])
    )
    updated = await update_node(conn, node.id, NodeUpdate(title="B"))

    assert updated is not None
    assert updated.tags == ["keep"]


async def test_empty_tag_list_clears_tags(conn: aiosqlite.Connection) -> None:
    """Explicit [] must differ from omission, or tags can never be removed."""
    node = await create_node(
        conn, NodeCreate(type="idea", title="A", summary="s", tags=["gone"])
    )
    updated = await update_node(conn, node.id, NodeUpdate(tags=[]))

    assert updated is not None
    assert updated.tags == []


async def test_update_missing_node_returns_none(conn: aiosqlite.Connection) -> None:
    assert await update_node(conn, "no-such-id", NodeUpdate(title="x")) is None


async def test_delete_removes_node_and_its_edges(conn: aiosqlite.Connection) -> None:
    a = await create_node(conn, NodeCreate(type="idea", title="A", summary="s"))
    b = await create_node(conn, NodeCreate(type="idea", title="B", summary="s"))
    await create_edge(
        conn, EdgeCreate(source_id=a.id, target_id=b.id, relation_type="relates_to")
    )

    assert await delete_node(conn, a.id) is True
    assert await get_node(conn, a.id) is None
    assert await list_edges_for_node(conn, b.id) == []

    snapshot = await get_snapshot(conn)
    assert [n.id for n in snapshot.nodes] == [b.id]
    assert snapshot.edges == []


async def test_delete_missing_node_reports_false(conn: aiosqlite.Connection) -> None:
    assert await delete_node(conn, "no-such-id") is False


async def test_deleted_node_leaves_search_index(conn: aiosqlite.Connection) -> None:
    from app.search.service import search

    node = await create_node(
        conn, NodeCreate(type="idea", title="Ephemeral", summary="s")
    )
    await delete_node(conn, node.id)
    assert await search(conn, "Ephemeral", mode="keyword") == []


async def test_unlink_keeps_both_nodes(conn: aiosqlite.Connection) -> None:
    a = await create_node(conn, NodeCreate(type="idea", title="A", summary="s"))
    b = await create_node(conn, NodeCreate(type="idea", title="B", summary="s"))
    edge = await create_edge(
        conn, EdgeCreate(source_id=a.id, target_id=b.id, relation_type="relates_to")
    )

    assert await delete_edge(conn, edge.id) is True
    assert await get_node(conn, a.id) is not None
    assert await get_node(conn, b.id) is not None


async def test_tag_survives_on_other_nodes_after_delete(
    conn: aiosqlite.Connection,
) -> None:
    """Deleting one node must not strip a shared tag from the others."""
    a = await create_node(
        conn, NodeCreate(type="idea", title="A", summary="s", tags=["shared"])
    )
    b = await create_node(
        conn, NodeCreate(type="idea", title="B", summary="s", tags=["shared"])
    )
    await delete_node(conn, a.id)

    kept = await get_node(conn, b.id)
    assert kept is not None
    assert kept.tags == ["shared"]
    assert {tag.name: tag.count for tag in await list_tags(conn)}["shared"] == 1
