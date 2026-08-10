import json
import logging
import re

import aiosqlite

from app.attachments import files as files_service
from app.attachments import sources as sources_service
from app.attachments.models import FileOut, SourceOut
from app.core.identifiers import new_id, utcnow_iso
from app.core.queries import fetch_all, fetch_one, row_to_dict
from app.memories import tags as tags_service
from app.memories import types as types_service
from app.memories.models import NodeCreate, NodeOut, NodeSearchResult, NodeUpdate
from app.search import vectors
from app.search.embeddings import embed_document

logger = logging.getLogger(__name__)

_INSERT = """
INSERT INTO nodes
    (id, type, title, summary, content, thumbnail_url, status, target_date,
     metadata, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""
_BY_ID = "SELECT * FROM nodes WHERE id = ?"


def embedding_text(
    title: str, summary: str, content: str, tags: list[str] | None = None
) -> str:
    """What gets embedded for a memory.

    Title and summary carry most of the meaning in the least text, and the
    body is truncated: embedding models have a token limit, and a long note
    would otherwise dilute its own topic into an average of everything in it.

    Tags are included because they are often the only place a theme is named,
    and a memory tagged `jealousy` whose prose never says it should still be
    reachable by meaning.
    """
    joined = " ".join(tags or [])
    return f"{title}\n{summary}\n{joined}\n{content[:2000]}".strip()


async def _reindex_vector(conn: aiosqlite.Connection, node: NodeOut) -> None:
    """Keep the semantic index in step with a written memory.

    Never allowed to fail the write: an embedding is an optimisation for
    recall, and losing one is far less costly than losing the memory itself.
    """
    if not vectors.available(conn):
        return
    try:
        vector = await embed_document(
            embedding_text(node.title, node.summary, node.content, node.tags)
        )
        await vectors.upsert(conn, node.id, vector)
        await conn.commit()
    except Exception:
        logger.warning("Failed to embed node %s", node.id, exc_info=True)


def _to_node(
    row: aiosqlite.Row,
    tags: list[str],
    attachments: list[FileOut],
    citations: list[SourceOut],
) -> NodeOut:
    data = row_to_dict(row)
    data["metadata"] = json.loads(data["metadata"])
    data["tags"] = tags
    data["files"] = attachments
    data["sources"] = citations
    return NodeOut.model_validate(data)


async def create_node(conn: aiosqlite.Connection, data: NodeCreate) -> NodeOut:
    node_id = new_id()
    now = utcnow_iso()
    # Idempotent, and applied here rather than only in the tool so the HTTP
    # routes cannot write a class the tools would have refused.
    coerced = types_service.coerce_class(data.type, list(data.tags))
    data = data.model_copy(update={"type": coerced.type, "tags": coerced.tags})
    await types_service.ensure_type(conn, data.type)
    await conn.execute(
        _INSERT,
        (
            node_id,
            data.type,
            data.title,
            data.summary,
            data.content,
            data.thumbnail_url,
            data.status,
            data.target_date,
            json.dumps(data.metadata),
            now,
            now,
        ),
    )
    if data.tags:
        await tags_service.set_tags(conn, node_id, data.tags)
    await conn.commit()

    node = await get_node(conn, node_id)
    assert node is not None
    await _reindex_vector(conn, node)
    return node


async def get_node(conn: aiosqlite.Connection, node_id: str) -> NodeOut | None:
    row = await fetch_one(conn, _BY_ID, (node_id,))
    if row is None:
        return None
    return _to_node(
        row,
        await tags_service.get_tags(conn, node_id),
        await files_service.list_for_node(conn, node_id),
        await sources_service.list_for_node(conn, node_id),
    )


async def update_node(
    conn: aiosqlite.Connection, node_id: str, data: NodeUpdate
) -> NodeOut | None:
    """Apply a partial update. Returns None if the node is gone."""
    if await get_node(conn, node_id) is None:
        return None

    fields = data.model_dump(exclude_unset=True, exclude={"tags"})
    if "type" in fields:
        coerced = types_service.coerce_class(fields["type"], list(data.tags or []))
        fields["type"] = coerced.type
        if data.tags is not None:
            data = data.model_copy(update={"tags": coerced.tags})
        await types_service.ensure_type(conn, fields["type"])
    if "metadata" in fields:
        fields["metadata"] = json.dumps(fields["metadata"])

    if fields:
        fields["updated_at"] = utcnow_iso()
        assignments = ", ".join(f"{column} = ?" for column in fields)
        await conn.execute(
            f"UPDATE nodes SET {assignments} WHERE id = ?",  # noqa: S608
            (*fields.values(), node_id),
        )

    # Distinguish "not provided" from "provided empty": only an explicit list
    # replaces the tags.
    if data.tags is not None:
        await tags_service.set_tags(conn, node_id, data.tags)

    await conn.commit()

    updated = await get_node(conn, node_id)
    if updated is not None:
        await _reindex_vector(conn, updated)
    return updated


async def delete_node(conn: aiosqlite.Connection, node_id: str) -> bool:
    """Remove a node. Its edges and tag links cascade away with it.

    The vector table is virtual, so foreign keys do not reach it — its row has
    to be removed explicitly or the index accumulates orphans. Attached bytes
    need the same treatment for the same reason, and a tombstone is left behind
    so cached clients find out.
    """
    await vectors.delete(conn, node_id)
    # Before the rows go: the file table cascades, the disk does not.
    await files_service.purge_for_node(conn, node_id)
    cursor = await conn.execute("DELETE FROM nodes WHERE id = ?", (node_id,))

    if cursor.rowcount > 0:
        # A tombstone, so a client holding a cached graph learns the memory is
        # gone rather than keeping it until its next full reload.
        await conn.execute(
            "INSERT OR REPLACE INTO deleted_nodes (id, deleted_at) VALUES (?, ?)",
            (node_id, utcnow_iso()),
        )

    await conn.commit()
    return cursor.rowcount > 0


def _words(text: str) -> list[str]:
    """Bare words, with everything FTS5 reads as syntax removed.

    Only what is syntax *outside* a quoted string: every term built here is
    quoted, and inside quotes FTS5 has no operators. So `-`, `:` and `.`
    survive, and `claude-code` stays one phrase rather than two words.
    """
    return re.sub(r'["*^()]', " ", text).split()


def build_fts_query(raw: str) -> str:
    """Turn free text into a safe FTS5 expression.

    Raw input cannot go straight into MATCH: a stray quote or a bare `AND`
    raises a syntax error rather than returning nothing. Each word is stripped
    of syntax characters and quoted, then given a `*` so search-as-you-type
    matches prefixes — typing "syn" should find "SYNAPSSE".

    Double quotes survive as a phrase: `"memory graph"` matches those two words
    adjacent and in that order, and takes no `*`, because someone who quotes a
    string is asking for that string and not for everything starting with it.
    An unclosed quote is treated as loose words — mid-typing is the normal way
    to see one, and erroring on it would make the box flicker.
    """
    segments = raw.split('"')
    terms: list[str] = []

    for index, segment in enumerate(segments):
        # Odd segments sit between a pair of quotes. The last one never does:
        # reaching it means the closing quote was never typed.
        if index % 2 == 1 and index < len(segments) - 1:
            if words := _words(segment):
                terms.append('"{}"'.format(" ".join(words)))
        else:
            terms.extend(f'"{word}"*' for word in _words(segment))

    return " ".join(terms)


_SUMMARIES = """
SELECT id, type, title, summary
FROM nodes
WHERE id IN ({placeholders})
"""


async def summaries_for(
    conn: aiosqlite.Connection, node_ids: list[str]
) -> dict[str, NodeSearchResult]:
    """Index-sized rows for a set of ids, keyed by id.

    A dict rather than a list because every caller has an order of its own —
    a fused ranking, a walked path — and SQL will not return one.
    """
    if not node_ids:
        return {}

    placeholders = ",".join("?" for _ in node_ids)
    rows = await fetch_all(conn, _SUMMARIES.format(placeholders=placeholders), node_ids)
    return {
        row["id"]: NodeSearchResult.model_validate(row_to_dict(row)) for row in rows
    }


async def missing_ids(conn: aiosqlite.Connection, node_ids: list[str]) -> list[str]:
    """Which of `node_ids` are not in the store, in the order given.

    Asked before a write that would link to them: the foreign key catches an
    unknown id only after the node is committed, leaving a stored memory and
    an error in the caller's hands.
    """
    if not node_ids:
        return []
    found = await summaries_for(conn, node_ids)
    return [node_id for node_id in node_ids if node_id not in found]


_MARK_READ = """
UPDATE nodes SET last_read_at = ?, read_count = read_count + 1 WHERE id = ?
"""


async def mark_read(conn: aiosqlite.Connection, node_id: str) -> None:
    """Record that something opened this memory.

    Only ever called from the tool an agent uses to read a node, never from
    the internal get_node that writes go through — otherwise every save would
    look like a read and the staleness list would be empty forever.

    Deliberately does not touch updated_at: being read is not a change, and
    bumping it would make every client re-fetch a node nobody edited.
    """
    await conn.execute(_MARK_READ, (utcnow_iso(), node_id))
    await conn.commit()


_STALE = """
SELECT id, type, title, summary, created_at, last_read_at, read_count
FROM nodes
WHERE read_count = 0 AND created_at < ?
ORDER BY created_at
LIMIT ?
"""


async def list_stale(
    conn: aiosqlite.Connection, before: str, limit: int = 20
) -> list[dict[str, object]]:
    """Memories nothing has opened since they were written, oldest first.

    Never read is the only signal worth acting on. Age alone says nothing —
    a two-year-old note about how someone likes to be given feedback may be
    the most valuable row in the store — and a memory that is read often is
    earning its place however old it is.
    """
    rows = await fetch_all(conn, _STALE, (before, limit))
    return [row_to_dict(row) for row in rows]


_ROADMAP = """
SELECT id, type, title, summary, status, target_date
FROM nodes
WHERE status IS NOT NULL
ORDER BY
    -- Undated work sorts last: a plan with a date is a commitment, and one
    -- without is an intention, and a roadmap that mixes them by creation time
    -- reads as neither.
    CASE WHEN target_date IS NULL THEN 1 ELSE 0 END,
    target_date,
    created_at
"""


async def list_roadmap(conn: aiosqlite.Connection) -> list[dict[str, str | None]]:
    """Every memory carrying a status, in the order a roadmap reads.

    Deliberately narrow — no content, no metadata. An agent asking what is in
    flight wants the shape of the work, and paying for the body of every plan
    to find out is the cost this store exists to avoid.
    """
    rows = await fetch_all(conn, _ROADMAP)
    return [row_to_dict(row) for row in rows]
