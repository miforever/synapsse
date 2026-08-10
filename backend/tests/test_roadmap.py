"""Work with a state — the memories a roadmap draws."""

import aiosqlite
import pytest
from pydantic import ValidationError

from app.canvas.graph import get_snapshot
from app.memories.models import NodeCreate, NodeUpdate
from app.memories.nodes import create_node, get_node, list_roadmap, update_node


async def _plan(
    conn: aiosqlite.Connection,
    title: str,
    status: str | None = None,
    target: str | None = None,
) -> str:
    node = await create_node(
        conn,
        NodeCreate(
            type="plan",
            title=title,
            summary="s",
            status=status,  # type: ignore[arg-type]
            target_date=target,
        ),
    )
    return node.id


async def test_status_and_target_round_trip(conn: aiosqlite.Connection) -> None:
    node_id = await _plan(conn, "Ship it", "doing", "2026-09-01")

    node = await get_node(conn, node_id)
    assert node is not None
    assert node.status == "doing"
    assert node.target_date == "2026-09-01"


async def test_most_memories_carry_no_status(conn: aiosqlite.Connection) -> None:
    """A fact is not "todo" — the columns stay empty unless work is meant."""
    node = await create_node(
        conn, NodeCreate(type="finding", title="Sky is blue", summary="s")
    )
    assert node.status is None
    assert node.target_date is None


@pytest.mark.parametrize("status", ["todo", "doing", "done", "dropped"])
async def test_the_four_states_are_accepted(
    conn: aiosqlite.Connection, status: str
) -> None:
    node_id = await _plan(conn, f"Work {status}", status)
    stored = await get_node(conn, node_id)
    assert stored is not None
    assert stored.status == status


def test_an_invented_state_is_refused() -> None:
    """Closed, unlike classes: a fifth state would have nowhere to be drawn."""
    with pytest.raises(ValidationError):
        NodeCreate(type="plan", title="t", summary="s", status="maybe")  # type: ignore[arg-type]


def test_a_target_must_be_a_day() -> None:
    with pytest.raises(ValidationError):
        NodeCreate(type="plan", title="t", summary="s", target_date="next tuesday")


async def test_status_can_be_changed_without_touching_anything_else(
    conn: aiosqlite.Connection,
) -> None:
    node_id = await _plan(conn, "Ship it", "todo", "2026-09-01")
    updated = await update_node(conn, node_id, NodeUpdate(status="done"))

    assert updated is not None
    assert updated.status == "done"
    # The date it was aimed at survives being finished.
    assert updated.target_date == "2026-09-01"
    assert updated.title == "Ship it"


async def test_roadmap_puts_dated_work_first_and_in_order(
    conn: aiosqlite.Connection,
) -> None:
    await _plan(conn, "someday", "todo")
    await _plan(conn, "later", "todo", "2026-12-01")
    await _plan(conn, "sooner", "doing", "2026-09-01")
    await create_node(conn, NodeCreate(type="finding", title="unrelated", summary="s"))

    roadmap = await list_roadmap(conn)

    assert [item["title"] for item in roadmap] == ["sooner", "later", "someday"]
    # Nothing without a status appears at all.
    assert all(item["status"] is not None for item in roadmap)


async def test_the_canvas_snapshot_carries_status(
    conn: aiosqlite.Connection,
) -> None:
    """The roadmap draws from the snapshot, so it has to be in there."""
    await _plan(conn, "Ship it", "doing", "2026-09-01")

    snapshot = await get_snapshot(conn)
    drawn = next(node for node in snapshot.nodes if node.title == "Ship it")
    assert drawn.status == "doing"
    assert drawn.target_date == "2026-09-01"
