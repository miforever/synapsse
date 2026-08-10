import aiosqlite
import pytest

from app.core.fields import FALLBACK_CLASS
from app.core.slug import slugify
from app.memories.models import NodeCreate
from app.memories.nodes import create_node, get_node
from app.memories.tags import find_nodes_by_tag, list_tags, set_tags
from app.memories.types import list_types


def test_slugify_normalizes_variants() -> None:
    assert slugify("Task") == "task"
    assert slugify("  TASK  ") == "task"
    assert slugify("Follow Up") == "follow_up"
    assert slugify("bug--report") == "bug_report"


def test_slugify_rejects_empty() -> None:
    with pytest.raises(ValueError):
        slugify("!!!")


async def test_default_types_are_seeded(conn: aiosqlite.Connection) -> None:
    names = set(await list_types(conn))
    assert {"person", "project", "idea", "fact", "object", "place"} <= names


async def test_unknown_class_is_kept_as_a_tag(conn: aiosqlite.Connection) -> None:
    """The write survives, the word survives, the taxonomy does not grow."""
    node = await create_node(
        conn, NodeCreate(type="Retrospective", title="R", summary="s")
    )
    assert node.type == FALLBACK_CLASS
    assert "retrospective" in node.tags
    assert "retrospective" not in await list_types(conn)


async def test_the_class_set_does_not_grow(conn: aiosqlite.Connection) -> None:
    before = set(await list_types(conn))
    for variant in ("Task", "task", " TASK ", "Retrospective"):
        await create_node(conn, NodeCreate(type=variant, title="T", summary="s"))
    assert set(await list_types(conn)) == before


async def test_class_variants_normalise(conn: aiosqlite.Connection) -> None:
    for variant in ("Person", " PERSON ", "person"):
        node = await create_node(conn, NodeCreate(type=variant, title="P", summary="s"))
        assert node.type == "person"


async def test_a_real_class_keeps_its_tags_alone(conn: aiosqlite.Connection) -> None:
    node = await create_node(
        conn,
        NodeCreate(type="person", title="Ada", summary="s", tags=["girlfriend"]),
    )
    assert node.type == "person"
    assert node.tags == ["girlfriend"]


async def test_tags_round_trip(conn: aiosqlite.Connection) -> None:
    node = await create_node(
        conn,
        NodeCreate(type="idea", title="Tagged", summary="s", tags=["Q3", "roadmap"]),
    )
    assert node.tags == ["q3", "roadmap"]

    fetched = await get_node(conn, node.id)
    assert fetched is not None
    assert fetched.tags == ["q3", "roadmap"]


async def test_find_nodes_by_tag(conn: aiosqlite.Connection) -> None:
    node = await create_node(
        conn, NodeCreate(type="plan", title="P", summary="s", tags=["roadmap"])
    )
    await create_node(conn, NodeCreate(type="fact", title="F", summary="s"))

    assert await find_nodes_by_tag(conn, "roadmap") == [node.id]


async def test_list_tags_reports_usage_counts(conn: aiosqlite.Connection) -> None:
    await create_node(
        conn, NodeCreate(type="idea", title="A", summary="s", tags=["shared", "solo"])
    )
    await create_node(
        conn, NodeCreate(type="idea", title="B", summary="s", tags=["shared"])
    )

    counts = {tag.name: tag.count for tag in await list_tags(conn)}
    assert counts["shared"] == 2
    assert counts["solo"] == 1


async def test_set_tags_replaces_existing(conn: aiosqlite.Connection) -> None:
    node = await create_node(
        conn, NodeCreate(type="idea", title="A", summary="s", tags=["old"])
    )
    await set_tags(conn, node.id, ["new"])
    await conn.commit()

    fetched = await get_node(conn, node.id)
    assert fetched is not None
    assert fetched.tags == ["new"]


async def test_node_tags_cascade_on_node_delete(conn: aiosqlite.Connection) -> None:
    node = await create_node(
        conn, NodeCreate(type="idea", title="A", summary="s", tags=["doomed"])
    )
    await conn.execute("DELETE FROM nodes WHERE id = ?", (node.id,))
    await conn.commit()

    assert await find_nodes_by_tag(conn, "doomed") == []
