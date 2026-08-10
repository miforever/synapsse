<p align="center">
  <img src="frontend/public/branding/synapsse-desktop.svg" alt="SYNAPSSE" width="420">
</p>

<p align="center">
  A local-first memory graph daemon — a connection-based memory layer for AI
  agents and the humans working alongside them.
</p>

---

SYNAPSSE runs as a local async Python daemon over embedded SQLite, exposes
itself to agents through the Model Context Protocol, and renders the resulting
memory graph as an interactive WebGL canvas. No cloud services, no database
server, no configuration.

## Why

Agents accumulate context but have nowhere durable to put it. Every session
starts cold, so the same explanations get re-typed and the same decisions get
re-litigated — and the usual fix, replaying a transcript into the context
window, pays for everything that was ever said to recall the one thing that
matters now.

SYNAPSSE stores memories as a graph of linked nodes and hands agents a
deliberately token-frugal read path: search a lightweight index, fetch only the
node you need, then traverse outward from it. Recall costs a fraction of what
dumping a transcript would, and what comes back is structured — a decision, its
reasons, and what it depends on — rather than a wall of chat.

The canvas exists because a memory store you cannot see is a memory store you
cannot trust. Everything an agent writes appears on it as it is written.

## Stack

| Layer    | Technology                                                          |
| -------- | ------------------------------------------------------------------- |
| Daemon   | Python 3.11, FastAPI, uvicorn                                        |
| Storage  | SQLite via aiosqlite — WAL journaling, FTS5 full-text search         |
| Search   | Hybrid keyword + semantic, via sqlite-vec and local ONNX embeddings  |
| Agents   | FastMCP (Model Context Protocol)                                     |
| Realtime | WebSockets                                                           |
| Canvas   | Next.js, Tailwind CSS, react-force-graph 2D/3D, Three.js             |

## Layout

```
synapsse/
├── backend/    FastAPI + aiosqlite + FastMCP daemon
├── frontend/   Next.js + react-force-graph canvas
└── docker/     Dockerfiles and compose stack
```

## Quickstart

Clone it:

```bash
git clone https://github.com/miforever/synapsse.git && cd synapsse
```

Docker — brings up both services:

```bash
docker compose -f docker/docker-compose.yml up --build
```

Or run them natively:

```bash
cd backend && uv sync && uv run uvicorn app.main:app --reload
cd frontend && npm install && npm run dev
```

- Daemon: http://localhost:8000 (health at `/health`)
- Canvas: http://localhost:3000

The first start fetches the embedding model (~2.2GB) before semantic search
answers; keyword search works immediately, and the download happens once.

Under Docker the database persists in the `synapsse-data` volume; natively it
lands at `backend/synapsse.db`, with attachments beside it in
`backend/synapsse_files/`. The two are one store — back up or move them
together.

## Connect an agent

With the daemon running, point any MCP client at `http://localhost:8000/mcp`.

**Claude Code** — one command:

```bash
claude mcp add --scope user --transport http synapsse http://localhost:8000/mcp
```

`--scope user` is the part worth not skipping. Without it the server is
registered for the directory the command happened to run in, and a memory meant
to follow you between projects is reachable from exactly one of them.

Or commit it to the project by writing `.mcp.json`:

```json
{
  "mcpServers": {
    "synapsse": {
      "type": "http",
      "url": "http://localhost:8000/mcp"
    }
  }
}
```

**Cursor** — add the same block to `~/.cursor/mcp.json`.

**Then restart the client.** MCP servers are connected once, when a session
starts, so the session that registered the server does not have its tools —
they attach to the next one. An agent that says it cannot see SYNAPSSE
immediately after adding it is not misconfigured, it just has not been
restarted. In Claude Code, `claude --continue` picks the conversation back up
where it was.

After that, ask the agent to remember something. The node appears on the canvas
as it is written, with no refresh.

### What the agent is told

A memory store is only worth what its shape is worth, and an agent left to
guess writes long unlinked notes and invents a class per noun. So the daemon
tells it how the graph is meant to be built, in the MCP `initialize` handshake
before any tool is called — the conventions travel with the server rather than
living in each user's project, so every client works to the same ones without
anyone copying a file around.

The gist, in full at `backend/app/mcp/guidance.py`:

- Search before writing; correct a memory rather than contradicting it.
- A **class** is the shape, **tags** are the specifics. A girlfriend is a
  `person` tagged `girlfriend`, not a class of her own.
- One memory, one thing. A problem and its fix are two, joined by an edge — so
  the fix can also be linked to the other problems it solved.
- Connect what you write. An unlinked memory is nearly unreachable, and the
  link across topics is the one nobody thinks to record.
- Read outside in: index, then one node, then outward.

Two prompts come with it, for when the shape matters enough to ask for it
deliberately: **`remember`** captures something with the right structure, and
**`recall`** answers a question while reading as little of the graph as it can.

### Remembering without being asked

A user who has to notice that something is worth keeping, and then say so, is
doing the job this server exists to do for them — and by the time they think to
ask, the session where it mattered is over. So the instructions tell agents to
write as they work: when a preference is stated, a decision made, a person
learned about, a problem diagnosed or fixed. And to search here before asking a
question the user has already answered.

Be aware of what that guarantee is worth. MCP gives a server no way to make a
client do anything — instructions are advisory, they land in the model's
context, and how strongly a given client weighs them varies. In practice they
work well and are the right default, but if capture matters to you, add the
same expectation somewhere your client treats as binding. For Claude Code, in
`CLAUDE.md`:

```markdown
## Memory
Record to SYNAPSSE as you work, without being asked — preferences, decisions
and their reasons, people, and problems with what fixed them. Search it before
asking me something I may have already answered.
```

Belt and braces, for the same reason a reminder written in two places gets
read.

### Recall without being asked

Writing is the easy half. The hard half is being *read* — and an agent only
searches when it occurs to it to search, which is not the case where recall
would have paid. It does not know what it does not know.

No server can fix that, because the decision to retrieve happens in the client.
A hook can. `hooks/synapsse_recall.py` runs on every message you send, searches
the store with your own words, and prints what it finds into the model's
context *before* the model decides anything — no tool call to remember, no
judgement to exercise.

For Claude Code, in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 /absolute/path/to/synapsse/hooks/synapsse_recall.py"
          }
        ]
      }
    ]
  }
}
```

Open `/hooks` once afterwards, or restart, so the settings are re-read — a hook
added mid-session is not always picked up by the running one. You will know it
works when memories appear above the reply without anything having called a
tool.

It needs nothing outside the standard library, adds about 130ms to a message,
and is written so that every failure — daemon down, still loading, answering
nonsense — prints nothing and costs you nothing. Short prompts ("yes", "go on")
and slash commands are skipped rather than searched.

Tune it with the environment, where it is registered:

| Variable | Default | |
| --- | --- | --- |
| `SYNAPSSE_URL` | `http://127.0.0.1:8000` | Where the daemon is |
| `SYNAPSSE_TOKEN` | — | Sent as `X-Synapsse-Token` when set |
| `SYNAPSSE_RECALL_LIMIT` | `5` | Memories injected per message |
| `SYNAPSSE_RECALL_TIMEOUT` | `1.5` | Seconds before giving up silently |

The block is labelled as background rather than instruction, deliberately: the
summaries were written by an earlier agent session, and a note must never be
able to issue orders to a later one just by phrasing itself as a command.

## Memory model

Each memory is a **node** — a title, a short summary for cheap index reads, a
full Markdown body, and free-form JSON metadata. Nodes are joined by typed,
weighted **edges** — `depends_on`, `part_of`, and `relates_to` for a link that
is real but unstructured.

There is no `blocks`: it said exactly what `depends_on` says with the ends
swapped, so one situation could be recorded two ways and every reader had to
normalise before it could answer.

Nodes are organized two ways:

- **Class** — exactly one per node, from a fixed thirteen: entities (`person`,
  `organization`, `place`, `object`), work (`project`, `plan`, `issue`,
  `event`), and knowledge (`idea`, `fact`, `decision`, `preference`,
  `resource`). Closed on purpose — the canvas paints a colour per class, and a
  set that grows at runtime is a set where half the graph is the fallback grey.
- **Tags** — any number per node, created freely and indexed for filtering.

The split is deliberate: a class is the shape, tags are the specifics. A
girlfriend is a `person` tagged `girlfriend`; a pet is an `object` tagged `pet`.
A word that is not a class is kept as a tag and the write still succeeds — the
memory is never lost to a vocabulary argument, and the response says what it
did.

Adding a fourteenth class is a release rather than a migration, and
`list_vocabulary` returns tag counts, so the tags that keep accumulating are
the evidence for which one to add.

Names are normalized on write, so `Task`, `task`, and `TASK` resolve to one
thing instead of three.

Memories are editable and removable — a store you cannot correct just
accumulates confidently stated mistakes.

## Files and sources

A memory can carry the things it is about and the evidence it rests on.

**Files** are copied into the daemon's own store rather than referenced where
they came from, so a memory survives the tidy-up that moved the original and
does not depend on which machine is reading it. Agents attach by path
(`attach_file`); you attach by dropping a file onto an open memory in the
canvas. Nothing a caller supplies is ever used to build a path — the name on
disk comes from the file's id — so an attachment called `../../etc/passwd` is
stored as harmlessly as any other.

**Sources** are the web pages a memory was written from, recorded with the
page's title and the line that was taken from it. Nothing is fetched to enrich
them: that would make writing a memory depend on a site being up, and would
send your reading list to whatever host was cited. Only `http(s)` is accepted.

Both are referenced from the memory's Markdown where they belong:

```markdown
The numbers behind this are in [[file:q3-benchmarks.csv]], and the approach
follows the reference implementation[[src:1]].
```

`[[file:NAME]]` renders as something to open, with a preview on hover.
`[[src:N]]` renders as a citation you can hover to see the source behind it.
A reference with nothing behind it is left visible as written — a broken
citation is a fact about the memory worth seeing.

## Roadmap

A memory given a **status** — `todo`, `doing`, `done`, `dropped` — and
optionally a **target date** becomes work, and appears on the roadmap at
`/roadmap`. Everything else stays a note: a fact is not "todo".

The board is the same graph seen differently, not a second store. Lanes come
from status, order from the target date (dated work is a commitment and sorts
before undated intentions), and the "waiting on" lines from the `depends_on`
and `blocks` edges the memories already had. `relates_to` is ignored — most
memories relate to each other, and that says nothing about sequence. Clicking a
card opens the same drawer as the canvas, so a plan is one click from the
decision behind it and the sources behind that.

`dropped` work stays on the board rather than being deleted. What you decided
against, and why, is worth as much later as what you did.

Agents move work along as they do it:

```python
set_status(node_id, "doing")
set_status(node_id, "done")
read_roadmap()   # id, title, status and target date — nothing else
```

## Agent tools

Exposed over MCP:

| Tool                                          | Purpose                                                  |
| --------------------------------------------- | -------------------------------------------------------- |
| `search_index(query, limit, mode)`            | Hybrid keyword + semantic search, lightweight candidates  |
| `read_node(node_id)`                          | Full content and immediate connections                    |
| `traverse_graph(node_id, depth)`              | Local structural map N hops out                           |
| `find_path(source_id, target_id, max_depth)`  | How two memories are connected, by the shortest route     |
| `add_memory(...)`                             | Persist a node, its tags, edges, files and sources        |
| `update_memory(...)`                          | Correct a memory; omitted fields stay untouched           |
| `delete_memory(node_id)`                      | Remove a memory and every edge touching it                |
| `link_memories(..., remove=False)`            | Connect two memories, or take the connection away         |
| `attach_file(..., remove="")`                 | Attach a file on this machine, or delete a stored copy    |
| `cite_source(..., remove="")`                 | Record where a claim came from, or drop a citation        |
| `read_roadmap()`                              | Everything with a status, soonest first                   |
| `stale_memories(days, limit)`                 | What nothing has read since it was written                |
| `list_vocabulary()`                           | The classes, the tags in use, and what the canvas renders |

Thirteen, down from eighteen. Each one is a schema in the system prompt of
every session in every project, so an inverse pair that could be a parameter
was costing context in perpetuity. `set_status` went for the same reason: it
was `update_memory` with fewer arguments.

## Search

Queries run through two engines at once. Full-text search finds exact terms —
names, identifiers, quoted phrases. Semantic search finds memories that mean
the same thing in different words, so "smooth rendering performance" reaches a
note about the canvas never stuttering.

The two rankings are merged with reciprocal rank fusion, which needs no shared
scale between a keyword rank and a cosine distance, and rewards memories both
engines agree on.

Fusion is the default, not the only option. Quote part of a query and that
phrase is required verbatim; pass `mode=keyword` and the semantic half is
dropped entirely, leaving the full-text ranking exactly as SQLite ordered it.
Both exist for the same reason: when you are after a literal string — a file
name, an identifier, an error message — a memory that merely means something
similar is noise. Keyword mode also answers before the embedding model has
been downloaded, since nothing is embedded.

Embeddings run locally: `intfloat/multilingual-e5-large` as ONNX on the CPU. It
is fetched once and then works offline — memory content is never sent
anywhere. It is retrieval-tuned and covers 100+ languages, so notes are
searchable in whatever language they were written.

Point `SYNAPSSE_EMBEDDING_MODEL` at any fastembed-supported model to trade size
for quality; set `SYNAPSSE_EMBEDDING_DIM` to match and re-run the backfill:

```bash
uv run python -m app.cli.reindex
```

If SQLite was built without extension support, semantic search is skipped and
keyword search continues to answer on its own.

## The canvas

The graph is rendered in 2D or 3D from the same node objects, so switching
views keeps the layout you were looking at.

- **Hover** a memory to light it, its neighbours, and the connections between
  them.
- **Click** to open it: the memory recedes everything else, and the drawer
  shows its content, files, sources and connections.
- **Drag** a memory to place it. Placed memories stay where you put them,
  across sessions; the rest of the graph settles around them and stays calm
  while you are holding one.
- **Ambient drift** keeps a settled graph alive rather than frozen, and the 3D
  scene turns slowly on its own. Both stand down when you take the camera, and
  are disabled entirely if your system asks for reduced motion.

Each view remembers its own camera, so switching 2D/3D and reloading return you
to where you were looking. The canvas is also cached locally and refreshed with
a delta, so a reload asks the daemon only what changed rather than
re-downloading the graph.

## Configuration

Everything has a working default. Three layers, each overriding the one before:
the built-in defaults, then `config.json` in the working directory, then
`SYNAPSSE_*` environment variables — the file for what you keep, the environment
for a particular run.

```jsonc
// backend/config.json — see config.example.json
{
  "db_path": "synapsse.db",
  "files_path": "synapsse_files",
  "max_file_bytes": 52428800,
  "host": "127.0.0.1",
  "port": 8000,
  "cors_origins": ["http://localhost:3000"]
}
```

## Development

```bash
cd backend
uv run ruff check --fix . && uv run ruff format .
uv run mypy app
uv run pytest

cd frontend
npm run lint && npm run build
npx playwright test        # needs the daemon and canvas running
```

CI runs the same checks and builds both images on every push and pull request
to `main` and `develop`.

## Running it on another machine

The daemon binds `127.0.0.1` and has **no authentication**. That default is
load-bearing: anything that can reach the port can read and rewrite every
memory, and `attach_file` takes a path on the host, so an open port is also a
way to copy files off that machine.

To use one memory from several of your own devices, do not change `host` and
open the port. Put the machines on a private network instead:

- **Tailscale** (or any WireGuard mesh) — install it on both, and the daemon is
  reachable at the host's private address, visible only to your devices.
- **SSH tunnel** — `ssh -N -L 8000:127.0.0.1:8000 you@host`, then point the
  agent at `http://localhost:8000/mcp` as usual.

Authentication is worth building before this is a documented feature rather
than a workaround; until it exists, the network is doing the access control.

## Privacy

Everything stays on your machine — one SQLite file, a directory of attachments,
no telemetry, no accounts.

Memory content is written by agents, so the canvas will not load media from it
until you say so. Images render by default; audio and video are click-to-load,
and remote sources are blocked entirely until enabled. Those switches live in
the control bar and persist in the daemon. Agents can read them (so they know
what is worth attaching) but cannot change them.

Attachments are served by the daemon itself, and sources are never fetched — so
opening a memory does not tell any third party that you did.

## Contributing

Issues and pull requests are welcome. A few things that will make review quick:

- Run the checks above before opening a PR; CI runs exactly the same ones.
- Explain *why* in the code where the reason is not obvious from it — this
  codebase comments the reasoning behind a choice, not what the line does.
- New behaviour comes with a test. The suite runs against an in-memory database
  and a stub embedder, so it is fast and needs no model download.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for any noncommercial purpose:
personal use, study, hobby projects, research, and use by charities, schools
and public institutions. You may read it, run it, change it and share your
changes, provided the notices travel with it.

Commercial use is not granted by this licence. If you want it for a business,
[open an issue](https://github.com/miforever/synapsse/issues).

Note on wording: this is **source-available**, not open source in the OSI
sense — the definition does not permit a restriction on the field of use. It
is deliberate, and the distinction is worth being accurate about.
