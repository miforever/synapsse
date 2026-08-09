import logging
from contextlib import suppress

import aiosqlite

from app.core.config import settings
from app.core.schema import (
    ADDITIONS,
    DEFAULT_NODE_TYPES,
    PRAGMAS,
    PRUNE_TOMBSTONES,
    SCHEMA,
    VECTOR_TABLE,
)
from app.search import vectors

logger = logging.getLogger(__name__)

SEED_TYPES_SQL = "INSERT OR IGNORE INTO node_types (name) VALUES (?)"


async def _load_vector_extension(conn: aiosqlite.Connection) -> bool:
    """Load sqlite-vec, which provides the vector index.

    Some SQLite builds are compiled without extension loading. Semantic search
    is unavailable there, but keyword search and everything else still work, so
    this reports failure instead of refusing to start.
    """
    try:
        import sqlite_vec

        await conn.enable_load_extension(True)
        await conn.load_extension(sqlite_vec.loadable_path())
        return True
    except Exception:
        logger.warning(
            "sqlite-vec unavailable; semantic search disabled", exc_info=True
        )
        return False
    finally:
        with suppress(Exception):
            await conn.enable_load_extension(False)


async def _apply_additions(conn: aiosqlite.Connection) -> None:
    """Add columns that postdate the original schema.

    SQLite has no `ADD COLUMN IF NOT EXISTS`, and asking whether a column
    exists first is the same round trip as trying and being told — so this
    tries, and treats "duplicate column name" as the success it is.
    """
    for statement in ADDITIONS:
        try:
            await conn.execute(statement)
        except aiosqlite.OperationalError as error:
            if "duplicate column name" not in str(error).lower():
                raise


async def init_db(db_path: str | None = None) -> aiosqlite.Connection:
    """Open a connection, apply PRAGMAs, and ensure the schema exists."""
    conn = await aiosqlite.connect(db_path or settings.db_path)
    conn.row_factory = aiosqlite.Row
    for pragma in PRAGMAS:
        await conn.execute(pragma)
    await conn.executescript(SCHEMA)
    await _apply_additions(conn)

    if await _load_vector_extension(conn):
        await conn.executescript(VECTOR_TABLE.format(dim=settings.embedding_dim))
        vectors.mark_available(conn)
    await conn.executemany(SEED_TYPES_SQL, [(name,) for name in DEFAULT_NODE_TYPES])
    # Boot is the natural moment: it is the one point where nothing is mid-read,
    # and a daemon that runs for weeks would otherwise never get round to it.
    await conn.execute(PRUNE_TOMBSTONES)
    await conn.commit()
    return conn


class Database:
    """Holds the single shared aiosqlite connection for the daemon's lifetime."""

    def __init__(self) -> None:
        self._conn: aiosqlite.Connection | None = None

    async def connect(self, db_path: str | None = None) -> None:
        self._conn = await init_db(db_path)

    async def disconnect(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("Database is not connected")
        return self._conn


db = Database()
