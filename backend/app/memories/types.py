import aiosqlite

from app.core.fields import FALLBACK_CLASS, NODE_CLASSES
from app.core.queries import fetch_column

_REGISTER = "INSERT OR IGNORE INTO node_types (name) VALUES (?)"
_LIST = "SELECT name FROM node_types ORDER BY name"


class Coerced(tuple[str, list[str], str | None]):
    """A class that was accepted, and what had to be done to accept it."""

    __slots__ = ()

    @property
    def type(self) -> str:
        return self[0]

    @property
    def tags(self) -> list[str]:
        return self[1]

    @property
    def notice(self) -> str | None:
        return self[2]


def coerce_class(name: str, tags: list[str]) -> Coerced:
    """Fit `name` to the closed set, keeping what it meant as a tag.

    Rejecting would be the tidier rule and the wrong one: an agent that hits an
    error mid-conversation loses the memory it was holding, and vocabulary can
    be merged later where a dropped write cannot be recovered. So the write
    always succeeds — the invented word becomes a tag, the memory takes the
    class that claims least, and the caller is told plainly what happened so it
    can correct the class if it disagrees.
    """
    if name in NODE_CLASSES:
        return Coerced((name, tags, None))

    kept = tags if name in tags else [*tags, name]
    return Coerced(
        (
            FALLBACK_CLASS,
            kept,
            f"{name!r} is not one of the classes, so this was stored as a "
            f"{FALLBACK_CLASS!r} tagged {name!r}. Classes are: "
            + ", ".join(NODE_CLASSES)
            + ". Call update_memory if another one fits better.",
        )
    )


async def ensure_type(conn: aiosqlite.Connection, name: str) -> None:
    """Register a class if the seed has not run for it yet.

    Only ever reached with a member of NODE_CLASSES now that coerce_class
    stands in front of every write, so this cannot introduce a new one — it
    exists so a database created before a class was added still gets its row.
    """
    await conn.execute(_REGISTER, (name,))


async def list_types(conn: aiosqlite.Connection) -> list[str]:
    return await fetch_column(conn, _LIST)
