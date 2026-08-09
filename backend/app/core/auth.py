"""One shared secret, checked before anything else runs.

Written as raw ASGI rather than a FastAPI dependency because the surface that
needs protecting is not only the routes: the MCP app is mounted as a sub-app
and the canvas connects over a WebSocket, and a dependency reaches neither.
Middleware sees every one of them.

There is no user model here on purpose. This daemon holds one person's memory
on one machine; the question it has to answer is "is this me", and a secret
answers it without a login screen, a session table or a password reset flow.
"""

import logging
import secrets
from urllib.parse import unquote

from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import settings

logger = logging.getLogger(__name__)

# Reachable without a token. /health is how a container, a proxy or a person
# with curl finds out whether the daemon is up, and that answer gives nothing
# away.
PUBLIC_PATHS = frozenset({"/health"})

_LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def token_from(scope: Scope) -> str | None:
    """The presented secret, from wherever this kind of client can put it.

    Headers for anything that can set them. A query parameter for WebSockets,
    where the browser API accepts no headers at all — it is not a worse secret
    for travelling in the URL of a same-machine connection, but it is the
    reason the token should never be a password reused elsewhere.
    """
    headers = {
        key.decode().lower(): value.decode() for key, value in scope.get("headers", [])
    }

    authorization: str = headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()

    header_token: str = headers.get("x-synapsse-token", "")
    if header_token:
        return header_token.strip()

    query: str = bytes(scope.get("query_string", b"")).decode()
    for pair in query.split("&"):
        key, _, value = pair.partition("=")
        if key == "token" and value:
            return unquote(value)

    return None


class TokenAuthMiddleware:
    """Rejects anything that cannot present the configured token."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in {"http", "websocket"} or settings.auth_token is None:
            await self.app(scope, receive, send)
            return

        if scope.get("path") in PUBLIC_PATHS:
            await self.app(scope, receive, send)
            return

        presented = token_from(scope)
        # Constant time: a plain == leaks how much of the token is right
        # through how long the comparison took.
        if presented is not None and secrets.compare_digest(
            presented, settings.auth_token
        ):
            await self.app(scope, receive, send)
            return

        await _reject(scope, send)


async def _reject(scope: Scope, send: Send) -> None:
    if scope["type"] == "websocket":
        await send({"type": "websocket.close", "code": 1008})
        return

    body = b'{"detail":"Missing or invalid token"}'
    await send(
        {
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                # Names the scheme so a client knows what to send back, and
                # says nothing about whether the token was wrong or absent.
                (b"www-authenticate", b'Bearer realm="synapsse"'),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


def warn_if_exposed() -> None:
    """Say so, loudly, when the daemon is reachable and unlocked.

    Binding off loopback without a token publishes a read-write API to the
    whole memory, and `attach_file` takes a path on this machine — so it is
    also a way to copy files off it. Refusing to start would be the safer
    choice; it would also strand anyone who binds 0.0.0.0 inside a container
    where the port is not actually published, which is common enough that the
    cure would be worse.
    """
    if settings.auth_token is None and settings.host not in _LOOPBACK:
        logger.warning(
            "SYNAPSSE is bound to %s with no SYNAPSSE_AUTH_TOKEN set. Anything "
            "that can reach this port can read and rewrite every memory. Set a "
            "token, or bind 127.0.0.1 and reach it over SSH or a private "
            "network.",
            settings.host,
        )
