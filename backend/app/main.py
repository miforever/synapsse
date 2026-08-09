import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import router as api_router
from app.core.auth import TokenAuthMiddleware, warn_if_exposed
from app.core.config import settings
from app.core.database import db
from app.mcp.server import mcp
from app.search.embeddings import warm_embedder
from app.ws.routes import router as ws_router

logger = logging.getLogger(__name__)

# path="/" keeps the endpoint at /mcp once mounted, rather than /mcp/mcp.
mcp_app = mcp.http_app(path="/")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    warn_if_exposed()
    await db.connect(settings.db_path)

    # Load the embedding model in the background.
    #
    # It loads lazily otherwise, which puts a measured 2.3s stall on the first
    # search of every run — right where someone is watching. Started as a task
    # rather than awaited: the daemon answers keyword search and every other
    # route immediately, and semantic search joins in once the model is ready.
    warming = asyncio.create_task(warm_embedder())

    try:
        # The MCP app carries its own lifespan; without running it the
        # streamable-HTTP session manager never starts and every agent
        # request fails with an uninitialized task group.
        async with mcp_app.lifespan(app):
            yield
    finally:
        warming.cancel()
        await db.disconnect()


def create_app() -> FastAPI:
    """
    Deliberately no compression middleware.

    The graph snapshot is the largest thing this daemon sends — 1.58MB at 2000
    memories, 531KB gzipped — but the canvas is normally on the same machine,
    where the bytes are free and the CPU is not: measured end to end, gzip took
    67ms against 21ms uncompressed. Sending less is the fix, not packing the
    same amount tighter. Put a reverse proxy in front if you ever serve the
    canvas over a real network.
    """
    app = FastAPI(title="SYNAPSSE", lifespan=lifespan)

    # Added first, so it sits *inside* CORS: the last middleware added is the
    # outermost, and a preflight OPTIONS carries no Authorization header. With
    # the order reversed the browser's preflight would be rejected and the
    # canvas could never make the real request at all.
    app.add_middleware(TokenAuthMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router)
    app.include_router(ws_router)
    app.mount("/mcp", mcp_app)
    return app


app = create_app()
