"""The token gate: off by default, absolute when switched on."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.auth import token_from
from app.core.config import settings
from app.main import create_app


@pytest.fixture
def token() -> Iterator[str]:
    settings.auth_token = "s3cret-token"
    yield "s3cret-token"
    settings.auth_token = None


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as running:
        yield running


def test_open_when_no_token_configured(client: TestClient) -> None:
    """The default stays what it was: loopback is the access control."""
    assert client.get("/graph").status_code == 200


def test_rejects_without_token(token: str, client: TestClient) -> None:
    response = client.get("/graph")
    assert response.status_code == 401
    assert response.headers["www-authenticate"].startswith("Bearer")


def test_accepts_bearer(token: str, client: TestClient) -> None:
    response = client.get("/graph", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200


def test_accepts_header(token: str, client: TestClient) -> None:
    assert client.get("/graph", headers={"X-Synapsse-Token": token}).status_code == 200


def test_rejects_wrong_token(token: str, client: TestClient) -> None:
    response = client.get("/graph", headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


def test_health_stays_public(token: str, client: TestClient) -> None:
    """A container's health check has no credentials, and needs none."""
    assert client.get("/health").status_code == 200


def test_websocket_needs_the_token(token: str, client: TestClient) -> None:
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect), client.websocket_connect("/ws/graph"):
        pass


def test_websocket_accepts_query_token(token: str, client: TestClient) -> None:
    """Browsers cannot set headers on a WebSocket, so the URL carries it."""
    with client.websocket_connect(f"/ws/graph?token={token}"):
        pass


def test_mcp_endpoint_is_behind_the_gate(token: str, client: TestClient) -> None:
    """The agent surface is the one that must never be open."""
    assert client.post("/mcp/", json={}).status_code == 401


@pytest.mark.parametrize(
    ("scope", "expected"),
    [
        ({"headers": [(b"authorization", b"Bearer abc")]}, "abc"),
        ({"headers": [(b"authorization", b"bearer abc")]}, "abc"),
        ({"headers": [(b"x-synapsse-token", b"abc")]}, "abc"),
        ({"headers": [], "query_string": b"token=abc"}, "abc"),
        ({"headers": [], "query_string": b"other=1&token=a%20b"}, "a b"),
        ({"headers": [], "query_string": b""}, None),
    ],
)
def test_token_is_read_from_every_supported_place(
    scope: dict[str, object], expected: str | None
) -> None:
    assert token_from(scope) == expected
