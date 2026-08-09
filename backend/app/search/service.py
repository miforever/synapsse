"""Hybrid search over the memory graph.

Keyword and semantic search fail in opposite directions. FTS5 is exact — it
finds names, identifiers and quoted phrases, and returns nothing when the
wording differs. Embeddings are the reverse: they find "what did we decide
about performance" in a note that never uses either word, but they are vague
about literal strings.

Results are combined with reciprocal rank fusion, which merges rankings
without needing the two scores to be comparable — a keyword rank and a cosine
distance have no common scale, so blending the raw numbers would mean
inventing a conversion and tuning it forever.

The fusion is the default rather than the only option. A caller who knows the
literal string they are after — an identifier, an error message, a name — is
badly served by a paraphrase outranking it, so `mode="keyword"` drops the
semantic half and answers from the text alone.
"""

from typing import Literal

import aiosqlite

from app.core.queries import fetch_all
from app.memories.models import NodeSearchResult
from app.memories.nodes import build_fts_query, summaries_for
from app.search import vectors
from app.search.embeddings import embed_query

SearchMode = Literal["hybrid", "keyword"]

# Damps the influence of top ranks so one engine cannot dominate the other.
# 60 is the value from the original RRF paper and behaves well without tuning.
RRF_K = 60

# Each engine is asked for more than the caller wants, so a result ranked
# modestly by both can still outrank one that only a single engine liked.
CANDIDATE_MULTIPLIER = 4

_FTS = """
SELECT nodes.id, nodes.type, nodes.title, nodes.summary
FROM nodes_fts
JOIN nodes ON nodes.id = nodes_fts.id
WHERE nodes_fts MATCH ?
ORDER BY rank
LIMIT ?
"""


async def _keyword_ranking(
    conn: aiosqlite.Connection, query: str, limit: int
) -> list[str]:
    expression = build_fts_query(query)
    if not expression:
        return []
    rows = await fetch_all(conn, _FTS, (expression, limit))
    return [row["id"] for row in rows]


async def _semantic_ranking(
    conn: aiosqlite.Connection, query: str, limit: int
) -> list[str]:
    if not vectors.available(conn) or await vectors.count(conn) == 0:
        return []
    vector = await embed_query(query)
    return [node_id for node_id, _ in await vectors.search(conn, vector, limit)]


def fuse(rankings: list[list[str]], limit: int) -> list[str]:
    """Reciprocal rank fusion over several ranked id lists."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for position, node_id in enumerate(ranking):
            scores[node_id] = scores.get(node_id, 0.0) + 1.0 / (RRF_K + position + 1)

    ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    return [node_id for node_id, _ in ordered[:limit]]


async def search(
    conn: aiosqlite.Connection,
    query: str,
    limit: int = 5,
    mode: SearchMode = "hybrid",
) -> list[NodeSearchResult]:
    """Search memories by keyword and meaning together, or by keyword alone.

    In `keyword` mode nothing is embedded and nothing is fused: results are the
    full-text ranking as SQLite ordered it, so the same query returns the same
    memories in the same order every time.
    """
    if not query.strip():
        return []

    depth = limit * CANDIDATE_MULTIPLIER
    keyword = await _keyword_ranking(conn, query, depth)
    semantic = [] if mode == "keyword" else await _semantic_ranking(conn, query, depth)

    ranked = fuse([r for r in (keyword, semantic) if r], limit)
    if not ranked:
        return []

    # SQL returns rows unordered; restore the fused ranking.
    by_id = await summaries_for(conn, ranked)
    return [by_id[node_id] for node_id in ranked if node_id in by_id]
