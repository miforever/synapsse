"""Writes that must not half-happen, and indexes that must not go stale.

Each of these covers a failure that leaves the store in a state the caller was
not told about — the kind an agent responds to by writing the memory again.
"""

import aiosqlite
import pytest

from app.core.database import init_db
from app.core.schema import TOMBSTONE_RETENTION_DAYS
from app.memories.models import NodeCreate
from app.memories.nodes import create_node, embedding_text, missing_ids
from app.memories.tools import add_memory, link_memories
from app.search.service import search


async def test_missing_ids_reports_only_the_absent(
    conn: aiosqlite.Connection,
) -> None:
    node = await create_node(
        conn, NodeCreate(type="fact", title="Real", summary="exists")
    )
    assert await missing_ids(conn, [node.id]) == []
    assert await missing_ids(conn, ["ghost", node.id]) == ["ghost"]
    assert await missing_ids(conn, []) == []


@pytest.fixture
async def live_db(conn: aiosqlite.Connection, monkeypatch: pytest.MonkeyPatch):
    """Point the module-level `db` the MCP tools use at the test connection."""
    from app.core.database import db

    monkeypatch.setattr(db, "_conn", conn)
    return conn


async def test_add_memory_writes_nothing_when_a_link_target_is_unknown(
    live_db: aiosqlite.Connection,
) -> None:
    """The bug: the node was committed, then the edge's foreign key failed.

    The caller saw an error and the memory was in the store anyway, so writing
    it again produced two of them.
    """
    result = await add_memory(
        title="Orphan",
        summary="must not survive a failed link",
        content="body",
        type="fact",
        linked_to=["no-such-node"],
    )

    assert result["written"] is False
    assert "no-such-node" in str(result["error"])
    assert await search(live_db, "Orphan", mode="keyword") == []


async def test_add_memory_still_writes_when_links_are_good(
    live_db: aiosqlite.Connection,
) -> None:
    target = await create_node(
        conn=live_db, data=NodeCreate(type="project", title="Target", summary="s")
    )
    result = await add_memory(
        title="Linked",
        summary="joins something real",
        content="body",
        type="fact",
        linked_to=[target.id],
    )

    assert "error" not in result
    assert len(result["edges"]) == 1


async def test_link_memories_rejects_unknown_ends(
    live_db: aiosqlite.Connection,
) -> None:
    node = await create_node(
        conn=live_db, data=NodeCreate(type="fact", title="Only", summary="s")
    )
    result = await link_memories(node.id, "ghost")
    assert "ghost" in str(result["error"])


def test_embedding_text_includes_tags() -> None:
    """A theme named only in a tag must still be reachable by meaning."""
    text = embedding_text(
        "Argument", "Recurring row", "no theme word here", ["jealousy"]
    )
    assert "jealousy" in text


async def test_identifiers_survive_the_query_builder(
    conn: aiosqlite.Connection,
) -> None:
    """Hyphens and colons are what a caller types when they mean it literally."""
    await create_node(
        conn,
        NodeCreate(
            type="issue",
            title="Crash",
            summary="traceback",
            content="raised from main.py:42 in claude-code",
        ),
    )
    assert len(await search(conn, "claude-code", mode="keyword")) == 1
    assert len(await search(conn, "main.py:42", mode="keyword")) == 1


async def test_old_tombstones_are_pruned_on_boot(tmp_path) -> None:
    path = str(tmp_path / "graph.db")
    conn = await init_db(path)
    stale = f"-{TOMBSTONE_RETENTION_DAYS + 1} days"
    await conn.execute(
        "INSERT INTO deleted_nodes (id, deleted_at) "
        "VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?))",
        ("ancient", stale),
    )
    await conn.execute(
        "INSERT INTO deleted_nodes (id) VALUES (?)",
        ("recent",),
    )
    await conn.commit()
    await conn.close()

    reopened = await init_db(path)
    rows = await reopened.execute_fetchall("SELECT id FROM deleted_nodes")
    remaining = {row["id"] for row in rows}
    await reopened.close()

    assert remaining == {"recent"}
