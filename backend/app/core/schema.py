"""Database schema definition and seed vocabulary.

Kept separate from connection handling so the DDL reads as one document.
"""

# Every timestamp column uses the same UTC ISO-8601 expression.
_NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"

TABLES = f"""
CREATE TABLE IF NOT EXISTS node_types (
    name TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT {_NOW}
);

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL REFERENCES node_types(name) ON UPDATE CASCADE,
    title TEXT NOT NULL CHECK (length(title) <= 100),
    summary TEXT NOT NULL CHECK (length(summary) <= 250),
    content TEXT NOT NULL DEFAULT '',
    thumbnail_url TEXT,
    metadata TEXT NOT NULL DEFAULT '{{}}',
    -- Where a piece of work stands, and when it is meant to land. Both are
    -- optional and both are free of meaning for most memories: a fact is not
    -- "todo". They live on the node rather than as edges to state nodes
    -- because they are properties of the thing, not relationships it has —
    -- and a graph where every plan sprouts an edge to a shared "done" node
    -- is a graph with one enormous hub in the middle of it.
    --
    -- Deliberately no CHECK constraint on status. The set is enforced in the
    -- models, where a bad value produces a clear error instead of an opaque
    -- IntegrityError, and where it stays identical between a database created
    -- fresh and one migrated by ALTER TABLE, which cannot add constraints.
    status TEXT,
    target_date TEXT,
    created_at TEXT NOT NULL DEFAULT {_NOW},
    updated_at TEXT NOT NULL DEFAULT {_NOW}
);

CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK (
        relation_type IN ('depends_on', 'relates_to', 'blocks', 'part_of')
    ),
    weight REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0.0 AND weight <= 1.0),
    created_at TEXT NOT NULL DEFAULT {_NOW}
);

CREATE TABLE IF NOT EXISTS tags (
    name TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT {_NOW}
);

-- Single-row key/value store for user preferences.
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT {_NOW}
);

-- Hand-arranged node positions, one row per canvas mode.
--
-- Kept apart from `nodes` on purpose: where a memory sits on the canvas is
-- view state, not part of the memory. The two modes lay out differently, so
-- each owns its own arrangement.
CREATE TABLE IF NOT EXISTS layouts (
    mode TEXT PRIMARY KEY CHECK (mode IN ('2d', '3d')),
    positions TEXT NOT NULL DEFAULT '{{}}',
    updated_at TEXT NOT NULL DEFAULT {_NOW}
);

-- Memories that have been deleted, and when.
--
-- A client holding a cached copy of the graph asks for what changed since it
-- last looked; without this it would be told about everything written and
-- nothing removed, so a deleted memory would linger on its canvas until a full
-- reload. The row is the only trace a memory leaves, which is why it carries
-- nothing but the id: what was deleted should not be recoverable from the
-- record that it was.
CREATE TABLE IF NOT EXISTS deleted_nodes (
    id TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL DEFAULT {_NOW}
);

-- Files attached to a memory.
--
-- The daemon keeps its own copy of the bytes rather than pointing at wherever
-- the file came from: a memory that breaks when someone tidies their Downloads
-- folder is not a memory. `stored_name` is what it is called inside the store,
-- always derived from the id, so nothing a caller supplies ever reaches a path.
-- `name` is the original, and only ever displayed.
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    stored_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT {_NOW}
);

-- Where a memory's claims came from.
--
-- Separate from `files`, which are things the memory *has*; a source is
-- something it *cites*. The distinction matters at the point of reading: an
-- attachment is opened, a source is checked, and a reader deciding whether to
-- believe a line wants the second without wading through the first.
--
-- `position` fixes the citation numbers. Content refers to sources as
-- [[src:1]], so their order has to be a stored property rather than whatever
-- the rows happen to come back in, or editing one renumbers the prose.
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    site TEXT NOT NULL DEFAULT '',
    snippet TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT {_NOW}
);

CREATE TABLE IF NOT EXISTS node_tags (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    tag TEXT NOT NULL REFERENCES tags(name) ON DELETE CASCADE,
    PRIMARY KEY (node_id, tag)
);
"""

INDEXES = """
CREATE INDEX IF NOT EXISTS idx_node_tags_tag ON node_tags(tag);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_files_node ON files(node_id);
-- Both of these are read on every node open, and written to on every citation
-- (which asks for the next free position). Without the index SQLite scans the
-- whole table each time: measured at 2ms against 50k rows, versus 0.02ms with
-- it.
CREATE INDEX IF NOT EXISTS idx_sources_node ON sources(node_id);
-- Every incremental fetch asks both of these "what changed after T".
CREATE INDEX IF NOT EXISTS idx_nodes_updated ON nodes(updated_at);
CREATE INDEX IF NOT EXISTS idx_deleted_at ON deleted_nodes(deleted_at);
"""

# Mirrors node text into an FTS5 index so search_index stays sub-millisecond.
FULLTEXT = """
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    id UNINDEXED,
    title,
    summary,
    content,
    tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts (rowid, id, title, summary, content)
    VALUES (new.rowid, new.id, new.title, new.summary, new.content);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    DELETE FROM nodes_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    UPDATE nodes_fts
    SET title = new.title, summary = new.summary, content = new.content
    WHERE rowid = new.rowid;
END;
"""

SCHEMA = TABLES + INDEXES + FULLTEXT

# Columns added after the first release.
#
# `CREATE TABLE IF NOT EXISTS` leaves an existing table exactly as it is, so a
# new column never reaches a database that already has one — every daemon
# updated in place would keep answering without it. Each of these is applied on
# boot and ignored when the column is already there, which is the whole of the
# migration story a single-file local database needs.
ADDITIONS: tuple[str, ...] = (
    "ALTER TABLE nodes ADD COLUMN status TEXT",
    "ALTER TABLE nodes ADD COLUMN target_date TEXT",
)

# How long a tombstone is worth keeping.
#
# It exists so a client with a cached graph learns that a memory was removed.
# A client that has not asked in ninety days is not applying a delta — it is
# reloading from scratch, and the row it would have used is a row nothing will
# ever read again. Without this the table is the one part of the store that
# only ever grows, in a product whose pitch is a single tidy file.
TOMBSTONE_RETENTION_DAYS = 90

PRUNE_TOMBSTONES = f"""
DELETE FROM deleted_nodes
WHERE deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-{
    TOMBSTONE_RETENTION_DAYS
} days')
"""

# Needs the sqlite-vec extension loaded first, so it is applied separately.
VECTOR_TABLE = """
CREATE VIRTUAL TABLE IF NOT EXISTS node_vectors USING vec0(
    node_id TEXT PRIMARY KEY,
    embedding float[{dim}]
);
"""

PRAGMAS = (
    "PRAGMA journal_mode=WAL",
    "PRAGMA synchronous=NORMAL",
    "PRAGMA foreign_keys=ON",
)

# Seeded on boot; agents may register further classes at runtime. How each is
# rendered (colour, icon, label casing) is entirely the canvas's concern.
#
# Deliberately coarse. A class is the *shape* of a thing and carries one colour
# on the canvas; anything more specific belongs in tags. A pet is an `object`
# tagged `animal`, not its own class — unless a given user tracks enough of
# them to justify registering one, which they can do without a migration.
DEFAULT_NODE_TYPES: tuple[str, ...] = (
    # Entities
    "person",
    "organization",
    "place",
    "object",
    # Work
    "project",
    "plan",
    "issue",
    "event",
    # Knowledge
    "idea",
    "fact",
    "decision",
    "preference",
    "resource",
)
