"""Keeping the store worth reading: no duplicates, typed links, upkeep.

Each of these guards a way a memory graph rots rather than breaks — a second
copy of a fact, an edge that says nothing, a row nobody has wanted since it was
written. Nothing here fails loudly in production, which is why it is tested.
"""

import aiosqlite
import pytest

from app.core.database import init_db
from app.memories import duplicates
from app.memories.models import NodeCreate
from app.memories.nodes import create_node, list_stale, mark_read
from app.memories.tools import add_memory, link_memories, read_node, stale_memories


@pytest.fixture
async def live_db(conn: aiosqlite.Connection, monkeypatch: pytest.MonkeyPatch):
    from app.core.database import db

    monkeypatch.setattr(db, "_conn", conn)
    return conn


async def test_a_second_copy_is_refused_with_the_first_in_full(
    live_db: aiosqlite.Connection,
) -> None:
    first = await add_memory(
        title="Runs ruff before committing",
        summary="Always runs ruff check --fix and ruff format before staging",
        content="Stated on 2026-08-09.",
        type="preference",
    )
    assert first["written"] is True

    second = await add_memory(
        title="Ruff before commits",
        summary="Always runs ruff check --fix and ruff format before staging",
        content="Said again in a later session.",
        type="preference",
    )
    assert second["written"] is False
    # The whole memory comes back, not just its id: folding the new detail in
    # should not cost a second round trip.
    assert second["duplicate_of"]["content"] == "Stated on 2026-08-09."
    assert second["similarity"] >= duplicates.SIMILARITY_THRESHOLD


async def test_force_writes_the_second_copy_anyway(
    live_db: aiosqlite.Connection,
) -> None:
    summary = "Always runs ruff check --fix and ruff format before staging"
    await add_memory(title="A", summary=summary, content="x", type="preference")
    forced = await add_memory(
        title="B", summary=summary, content="y", type="preference", force=True
    )
    assert forced["written"] is True


async def test_an_unrelated_memory_is_not_blocked(
    live_db: aiosqlite.Connection,
) -> None:
    """The gate has to be timid: a false refusal teaches agents to force."""
    await add_memory(
        title="Runs ruff before committing",
        summary="Always runs ruff check --fix and ruff format before staging",
        content="x",
        type="preference",
    )
    other = await add_memory(
        title="Prefers being asked before advice",
        summary="Wants a question rather than a recommendation when unsure",
        content="y",
        type="preference",
    )
    assert other["written"] is True


async def test_links_carry_the_relation_they_were_given(
    live_db: aiosqlite.Connection,
) -> None:
    project = await create_node(
        conn=live_db, data=NodeCreate(type="project", title="SYNAPSSE", summary="s")
    )
    written = await add_memory(
        title="Close the class set",
        summary="Thirteen classes, and a word that is not one becomes a tag",
        content="body",
        type="decision",
        linked_to=[{"id": project.id, "relation": "part_of"}],
    )
    assert written["edges"][0]["relation_type"] == "part_of"


async def test_a_bare_id_still_links(live_db: aiosqlite.Connection) -> None:
    """Agents copy older examples of themselves; the old shape must not error."""
    project = await create_node(
        conn=live_db, data=NodeCreate(type="project", title="P", summary="s")
    )
    written = await add_memory(
        title="Loose link",
        summary="joined without naming a relation",
        content="body",
        type="fact",
        linked_to=[project.id],
    )
    assert written["edges"][0]["relation_type"] == "relates_to"


async def test_an_invented_relation_is_refused(
    live_db: aiosqlite.Connection,
) -> None:
    project = await create_node(
        conn=live_db, data=NodeCreate(type="project", title="P", summary="s")
    )
    result = await add_memory(
        title="Bad",
        summary="names a relation that does not exist",
        content="body",
        type="fact",
        linked_to=[{"id": project.id, "relation": "blocks"}],
    )
    assert result["written"] is False
    assert "blocks" in str(result["error"])


async def test_link_and_unlink_are_one_tool(live_db: aiosqlite.Connection) -> None:
    left = await create_node(
        conn=live_db, data=NodeCreate(type="idea", title="L", summary="s")
    )
    right = await create_node(
        conn=live_db, data=NodeCreate(type="idea", title="R", summary="s")
    )
    await link_memories(left.id, right.id, "part_of")
    removed = await link_memories(left.id, right.id, "part_of", remove=True)
    assert removed["removed"] == 1


async def test_reading_a_memory_takes_it_off_the_stale_list(
    live_db: aiosqlite.Connection,
) -> None:
    node = await create_node(
        conn=live_db, data=NodeCreate(type="fact", title="Old", summary="s")
    )
    # Backdate it past the window; nothing has read it yet.
    await live_db.execute(
        "UPDATE nodes SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?",
        (node.id,),
    )
    await live_db.commit()

    assert [row["id"] for row in await stale_memories()] == [node.id]

    await read_node(node.id)
    assert await stale_memories() == []


async def test_mark_read_does_not_look_like_an_edit(
    conn: aiosqlite.Connection,
) -> None:
    """Reading must not bump updated_at, or every client re-fetches it."""
    node = await create_node(conn, NodeCreate(type="fact", title="F", summary="s"))
    await mark_read(conn, node.id)

    rows = await conn.execute_fetchall(
        "SELECT updated_at, read_count FROM nodes WHERE id = ?", (node.id,)
    )
    assert rows[0]["updated_at"] == node.updated_at.isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")
    assert rows[0]["read_count"] == 1


async def test_a_read_memory_is_never_stale(conn: aiosqlite.Connection) -> None:
    node = await create_node(conn, NodeCreate(type="fact", title="F", summary="s"))
    await mark_read(conn, node.id)
    assert await list_stale(conn, before="2999-01-01T00:00:00.000Z") == []


async def test_legacy_blocks_edges_are_turned_round(tmp_path) -> None:
    """blocks(A, B) is depends_on(B, A); the relationship survives the swap."""
    path = str(tmp_path / "legacy.db")
    conn = await init_db(path)
    for node_id in ("a", "b"):
        await conn.execute(
            "INSERT INTO nodes (id, type, title, summary) VALUES (?, 'fact', ?, 's')",
            (node_id, node_id),
        )
    # The old CHECK allowed `blocks`, so a legacy row is written straight in.
    await conn.execute("DROP TABLE edges")
    await conn.execute(
        "CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, "
        "relation_type TEXT, weight REAL DEFAULT 1.0, created_at TEXT)"
    )
    await conn.execute(
        "INSERT INTO edges (id, source_id, target_id, relation_type) "
        "VALUES ('e', 'a', 'b', 'blocks')"
    )
    await conn.commit()
    await conn.close()

    reopened = await init_db(path)
    rows = await reopened.execute_fetchall("SELECT * FROM edges")
    await reopened.close()

    assert rows[0]["relation_type"] == "depends_on"
    assert (rows[0]["source_id"], rows[0]["target_id"]) == ("b", "a")
