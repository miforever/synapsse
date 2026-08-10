"""Citations — where a memory's claims came from."""

import aiosqlite
import pytest

from app.attachments.models import SourceCreate
from app.attachments.sources import (
    UnusableSource,
    cite,
    delete_source,
    list_for_node,
    site_of,
)
from app.memories.models import NodeCreate
from app.memories.nodes import create_node, delete_node, get_node


async def _memory(conn: aiosqlite.Connection) -> str:
    node = await create_node(
        conn, NodeCreate(type="finding", title="Claim", summary="s")
    )
    return node.id


async def test_citing_records_what_the_agent_saw(conn: aiosqlite.Connection) -> None:
    node_id = await _memory(conn)
    source = await cite(
        conn,
        node_id,
        SourceCreate(
            url="https://www.sqlite.org/fts5.html",
            title="SQLite FTS5 Extension",
            snippet="FTS5 is a virtual table module providing full-text search.",
        ),
    )

    assert source.position == 1
    assert source.title == "SQLite FTS5 Extension"
    # Derived, so a citation always has something to be labelled with.
    assert source.site == "sqlite.org"


async def test_positions_number_in_citation_order(conn: aiosqlite.Connection) -> None:
    """`[[src:2]]` has to mean the second source, whatever the row order."""
    node_id = await _memory(conn)
    first = await cite(conn, node_id, SourceCreate(url="https://a.example/one"))
    second = await cite(conn, node_id, SourceCreate(url="https://b.example/two"))

    assert [first.position, second.position] == [1, 2]
    assert [s.position for s in await list_for_node(conn, node_id)] == [1, 2]


async def test_removing_one_does_not_renumber_the_rest(
    conn: aiosqlite.Connection,
) -> None:
    """Renumbering would silently repoint every citation after the gap."""
    node_id = await _memory(conn)
    first = await cite(conn, node_id, SourceCreate(url="https://a.example/one"))
    await cite(conn, node_id, SourceCreate(url="https://b.example/two"))
    third = await cite(conn, node_id, SourceCreate(url="https://c.example/three"))

    assert await delete_source(conn, first.id) is True

    remaining = await list_for_node(conn, node_id)
    assert [s.position for s in remaining] == [2, 3]
    assert remaining[-1].id == third.id


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html;base64,PHNjcmlwdD4=",
        "file:///etc/passwd",
        "not a url",
        "",
    ],
)
async def test_a_source_must_be_something_a_reader_can_open(
    conn: aiosqlite.Connection, url: str
) -> None:
    node_id = await _memory(conn)
    with pytest.raises(UnusableSource):
        await cite(conn, node_id, SourceCreate(url=url))


def test_site_is_the_host_as_a_reader_would_name_it() -> None:
    assert site_of("https://www.d3js.org/d3-force") == "d3js.org"
    # A port and a subdomain are part of neither how it is said nor how it is
    # recognised — except the subdomain, which often is.
    assert (
        site_of("https://news.ycombinator.com:443/item?id=1") == "news.ycombinator.com"
    )
    assert site_of("https://user@example.com/page") == "example.com"


async def test_memory_carries_its_sources(conn: aiosqlite.Connection) -> None:
    node_id = await _memory(conn)
    await cite(conn, node_id, SourceCreate(url="https://example.com/a", title="A"))

    node = await get_node(conn, node_id)
    assert node is not None
    assert [source.title for source in node.sources] == ["A"]


async def test_sources_go_with_the_memory(conn: aiosqlite.Connection) -> None:
    node_id = await _memory(conn)
    await cite(conn, node_id, SourceCreate(url="https://example.com/a"))

    assert await delete_node(conn, node_id) is True
    assert await list_for_node(conn, node_id) == []
