"""Hybrid search: keyword and semantic rankings fused."""

import aiosqlite

from app.memories.models import NodeCreate, NodeUpdate
from app.memories.nodes import create_node, delete_node, update_node
from app.search import vectors
from app.search.embeddings import set_embedder
from app.search.service import RRF_K, fuse, search


def test_fuse_rewards_agreement() -> None:
    """Agreed-on results beat ones only a single engine ranked.

    "b" is never first in either list, but it is the only id both engines
    return — which is exactly the signal fusion exists to capture.
    """
    keyword = ["a", "b"]
    semantic = ["c", "b"]

    assert fuse([keyword, semantic], 3)[0] == "b"


def test_fuse_ties_on_mirrored_rankings() -> None:
    """Two engines in exact disagreement carry no information, and RRF says so
    by scoring every id identically."""
    scores = fuse([["a", "b", "c"], ["c", "b", "a"]], 3)
    assert sorted(scores) == ["a", "b", "c"]


def test_fuse_handles_a_single_ranking() -> None:
    assert fuse([["x", "y"]], 5) == ["x", "y"]


def test_fuse_is_empty_without_rankings() -> None:
    assert fuse([], 5) == []


def test_fuse_respects_the_limit() -> None:
    assert len(fuse([["a", "b", "c", "d"]], 2)) == 2


def test_rrf_k_damps_top_ranks() -> None:
    """With a large K the gap between adjacent ranks stays small, which is what
    stops one engine's first result from automatically winning."""
    first = 1 / (RRF_K + 1)
    second = 1 / (RRF_K + 2)
    assert first - second < first * 0.02


async def test_vector_index_is_available(conn: aiosqlite.Connection) -> None:
    assert vectors.available(conn) is True


async def test_writing_a_memory_indexes_it(conn: aiosqlite.Connection) -> None:
    await create_node(
        conn, NodeCreate(type="idea", title="Indexed", summary="s", content="body")
    )
    assert await vectors.count(conn) == 1


async def test_deleting_a_memory_removes_its_vector(
    conn: aiosqlite.Connection,
) -> None:
    """The vector table is virtual, so cascades do not reach it."""
    node = await create_node(conn, NodeCreate(type="idea", title="A", summary="s"))
    assert await vectors.count(conn) == 1

    await delete_node(conn, node.id)
    assert await vectors.count(conn) == 0


async def test_editing_a_memory_reindexes_it(conn: aiosqlite.Connection) -> None:
    node = await create_node(conn, NodeCreate(type="idea", title="A", summary="s"))
    await update_node(conn, node.id, NodeUpdate(title="Completely different"))

    # Still exactly one vector: replaced rather than duplicated.
    assert await vectors.count(conn) == 1


async def test_exact_keyword_still_wins(conn: aiosqlite.Connection) -> None:
    """Semantic ranking must not drown out literal matches."""
    await create_node(
        conn,
        NodeCreate(type="finding", title="Postgres tuning", summary="database notes"),
    )
    await create_node(
        conn, NodeCreate(type="idea", title="Unrelated", summary="something else")
    )

    results = await search(conn, "Postgres", limit=5)
    assert results[0].title == "Postgres tuning"


async def test_search_finds_by_shared_vocabulary(
    conn: aiosqlite.Connection,
) -> None:
    await create_node(
        conn,
        NodeCreate(
            type="decision",
            title="Zero-lag canvas",
            summary="the graph must never stutter",
            content="rendering performance decision",
        ),
    )
    results = await search(conn, "rendering performance", limit=5)
    assert [r.title for r in results] == ["Zero-lag canvas"]


async def test_blank_query_returns_nothing(conn: aiosqlite.Connection) -> None:
    await create_node(conn, NodeCreate(type="idea", title="A", summary="s"))
    assert await search(conn, "   ") == []


async def test_hostile_query_does_not_raise(conn: aiosqlite.Connection) -> None:
    """FTS5 syntax in the box must not surface as an error through the hybrid
    path either."""
    await create_node(conn, NodeCreate(type="idea", title="A", summary="s"))
    for hostile in ['"', "AND", "*", "((", "a:b"]:
        await search(conn, hostile)


async def test_results_are_capped(conn: aiosqlite.Connection) -> None:
    for index in range(10):
        await create_node(
            conn, NodeCreate(type="idea", title=f"Note {index}", summary="shared words")
        )
    assert len(await search(conn, "shared words", limit=3)) == 3


async def test_keyword_mode_admits_only_text_matches(
    conn: aiosqlite.Connection,
) -> None:
    """The point of the mode: nothing arrives on similarity alone."""
    await create_node(
        conn, NodeCreate(type="finding", title="Postgres tuning", summary="database")
    )
    await create_node(
        conn, NodeCreate(type="idea", title="Unrelated", summary="something else")
    )

    assert len(await search(conn, "Postgres", limit=5)) == 2
    keyword = await search(conn, "Postgres", limit=5, mode="keyword")
    assert [r.title for r in keyword] == ["Postgres tuning"]


async def test_keyword_mode_honours_a_phrase(conn: aiosqlite.Connection) -> None:
    await create_node(
        conn,
        NodeCreate(type="finding", title="Local-first memory graph", summary="s"),
    )
    await create_node(
        conn,
        NodeCreate(type="finding", title="Graph of the memory", summary="s"),
    )

    results = await search(conn, '"memory graph"', limit=5, mode="keyword")
    assert [r.title for r in results] == ["Local-first memory graph"]


async def test_keyword_mode_needs_no_embedder(conn: aiosqlite.Connection) -> None:
    """Nothing is embedded, so the mode answers before the model is downloaded."""
    await create_node(conn, NodeCreate(type="finding", title="Offline", summary="s"))
    set_embedder(None)

    results = await search(conn, "Offline", limit=5, mode="keyword")
    assert [r.title for r in results] == ["Offline"]


async def test_search_survives_without_vectors(conn: aiosqlite.Connection) -> None:
    """With the extension unavailable, keyword search must still answer."""
    await create_node(
        conn, NodeCreate(type="finding", title="Keyword only", summary="s")
    )
    vectors._enabled.discard(conn)
    try:
        results = await search(conn, "Keyword", limit=5)
        assert [r.title for r in results] == ["Keyword only"]
    finally:
        vectors.mark_available(conn)
