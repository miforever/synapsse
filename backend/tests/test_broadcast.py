"""The realtime path: an agent write must reach connected canvases."""

from typing import Any

import aiosqlite
import pytest

from app.memories.edges import create_edge
from app.memories.models import EdgeCreate, NodeCreate
from app.memories.nodes import create_node
from app.ws.events import EVENT_NEW_NODE, broadcast_new_node
from app.ws.manager import ConnectionManager


class FakeSocket:
    """Stands in for a connected canvas."""

    def __init__(self, fail: bool = False) -> None:
        self.sent: list[dict[str, Any]] = []
        self.fail = fail

    async def accept(self) -> None:
        return None

    async def send_json(self, message: dict[str, Any]) -> None:
        if self.fail:
            raise ConnectionResetError("client vanished")
        self.sent.append(message)


@pytest.fixture
def manager() -> ConnectionManager:
    return ConnectionManager()


async def test_broadcast_reaches_every_client(manager: ConnectionManager) -> None:
    first, second = FakeSocket(), FakeSocket()
    await manager.connect(first)  # type: ignore[arg-type]
    await manager.connect(second)  # type: ignore[arg-type]

    await manager.broadcast("EVENT_TEST", {"hello": "world"})

    for socket in (first, second):
        assert socket.sent == [{"event": "EVENT_TEST", "payload": {"hello": "world"}}]


async def test_dead_client_is_evicted_not_raised(manager: ConnectionManager) -> None:
    """A closed tab must never make an agent's write fail."""
    healthy, dead = FakeSocket(), FakeSocket(fail=True)
    await manager.connect(healthy)  # type: ignore[arg-type]
    await manager.connect(dead)  # type: ignore[arg-type]

    await manager.broadcast("EVENT_TEST", {})

    assert manager.count == 1
    assert len(healthy.sent) == 1


async def test_new_node_event_payload(
    conn: aiosqlite.Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    local = ConnectionManager()
    socket = FakeSocket()
    await local.connect(socket)  # type: ignore[arg-type]
    monkeypatch.setattr("app.ws.events.manager", local)

    a = await create_node(
        conn, NodeCreate(type="idea", title="A", summary="s", content="# body")
    )
    b = await create_node(conn, NodeCreate(type="finding", title="B", summary="s"))
    edge = await create_edge(
        conn, EdgeCreate(source_id=a.id, target_id=b.id, relation_type="relates_to")
    )

    await broadcast_new_node(a, [edge])

    message = socket.sent[0]
    assert message["event"] == EVENT_NEW_NODE
    assert message["payload"]["node"]["id"] == a.id
    assert message["payload"]["edges"][0]["source"] == a.id
    # Content stays out of the wire payload; the canvas fetches it on open.
    assert "content" not in message["payload"]["node"]
