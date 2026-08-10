"""Catching the second copy of a memory before it is written.

Two memories of one fact is the failure the whole store is least able to
recover from. Search answers with whichever happens to rank first, neither is
more trustworthy than the other, and nothing about reading the graph tells you
it has happened — so it has to be caught at the point of writing.

The check is deliberately two-stage, and deliberately timid about the second
stage. Candidates come from hybrid search, so a memory worded differently is
still found; but only near-identical *text* actually blocks the write. A gate
that refuses too eagerly is worse than no gate: it teaches agents to pass
force=True out of habit, and then it is not a gate at all.
"""

from difflib import SequenceMatcher

import aiosqlite

from app.memories.models import NodeSearchResult
from app.search import service as search_service

# How alike two summaries have to read before one is refused. High on purpose —
# at 0.88 the pairs that trip it are the same sentence with a word moved.
SIMILARITY_THRESHOLD = 0.88

# Only the top few candidates are compared. If the duplicate is not in the
# leading results for its own summary, the store has bigger problems than this.
CANDIDATES = 5


def similarity(left: str, right: str) -> float:
    """How alike two short strings read, from 0 to 1."""
    return SequenceMatcher(None, left.strip().lower(), right.strip().lower()).ratio()


async def find_duplicate(
    conn: aiosqlite.Connection, title: str, summary: str
) -> tuple[NodeSearchResult, float] | None:
    """The memory this one would duplicate, if there is one.

    Matched on summary, because that is the field carrying the claim — two
    memories can have quite different titles for the same fact, and a title
    match with unrelated summaries is a coincidence rather than a duplicate.
    """
    candidates = await search_service.search(conn, summary, limit=CANDIDATES)
    if not candidates:
        return None

    scored = [
        (
            candidate,
            max(
                similarity(summary, candidate.summary),
                similarity(title, candidate.title),
            ),
        )
        for candidate in candidates
    ]
    best, score = max(scored, key=lambda pair: pair[1])
    return (best, score) if score >= SIMILARITY_THRESHOLD else None
