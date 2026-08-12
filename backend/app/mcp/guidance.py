"""What an agent is told about this server the moment it connects.

MCP hands the server a block of text in the initialize handshake, before any
tool is called. Tool descriptions can only say what one call does; this is the
only place that can say how the store is meant to be *shaped*.

It is charged for in every session of every project, so anything the schema can
enforce is not written here. Closing the class set deleted two hundred words of
pleading; refusing duplicates at the point of writing deleted more.
"""

INSTRUCTIONS = """
SYNAPSSE is a memory graph: a durable, connection-based store for what you
learn about the user and their work, so the next session starts warm.

## Record without being asked

Treat writing to this store as part of the work, not a separate task the user
requests. You will almost never be told "remember this" — a user who has to
notice something is worth keeping, and then say so, is doing the job this
server exists to do for them.

Write the moment one of these happens, not at the end of the session:

- They state a preference about how they work, or correct how you did it.
- A decision is made, especially one whose reason will not be obvious later.
- You learn something durable about a person, client or organization.
- A problem is diagnosed, and again when something actually fixes it.
- A constraint surfaces that will still be true next week.
- They change their mind about something previously decided.

Do not ask permission for each one, and do not narrate every write. What does
not belong: the conversation itself, anything already in the code or git
history, and anything only true for the next ten minutes.

## One memory, one thing

A memory is a single claim, decision, person or event — not a session log. A
problem and what fixed it are two memories joined by an edge: written that way
the fix can also be linked to the three other problems it solved, and revising
it later does not rewrite the history of the problem.

- `title` — how it appears on the canvas. Short and specific.
- `summary` — the line other agents read at index time, and the line a recall
  hook puts in front of them before they have decided anything. Make it carry
  the fact ("prefers being asked before advice"), not a description of the
  memory ("notes about communication"). This is what recall is paid for.
- `content` — the full Markdown: reasoning, quotes, detail.

## Class and tags

Every memory has one **class** from a fixed sixteen, and any number of **tags**
for the specifics.

- `person` a human · `creature` a living thing that is not human
- `organization` people acting as one body
- `place` somewhere things are located
- `object` an inanimate thing owned or handled · `device` a machine with state
  that runs and breaks · `document` content you can point at, file or contract
  or URL
- `event` something that occurred, at a time
- `project` sustained effort with a scope · `plan` an intention with an end
  state · `issue` a problem in play
- `decision` a choice and its reason · `preference` how someone wants things
  done · `constraint` a rule that binds whether or not they like it ·
  `finding` something learned, with evidence · `idea` a proposal not yet tested

A girlfriend is a `person` tagged `girlfriend`. A recurring argument is an
`issue` tagged with who it involves. A word that is not a class is kept as a
tag and the write still succeeds, so nothing is lost by guessing — but a class
that fits makes "show me every person" answerable, and the canvas colours by it.

Where the boundaries blur: an `idea` is untested, a `finding` is learned, a
`decision` is chosen. A `preference` is what someone likes and a `constraint`
is what they are bound by — do not file an obligation as a taste. A `place` is
somewhere you locate other things, an `object` is something owned or handled:
the garage is a place, the car in it is an object.

## Connect it to something

An unlinked memory is nearly unreachable — search finds it only if the words
happen to match, and nothing leads to it from anywhere else.

Link it to what it is about, with the relation that is true:

- `depends_on` — this needs that first.
- `part_of` — this belongs inside that.
- `relates_to` — the honest fallback when the link is real but unstructured.

Prefer a specific one; the roadmap ignores `relates_to`. Link across topics,
not only within them: the trait explaining both a disagreement with one person
and a delay on a project is exactly the connection worth recording, and the one
nobody thinks to write down.

## Reading

Work outside in, and stop as soon as you have enough:

1. `search_index(query)` — id, title and summary only. Add `mode="keyword"`, or
   quote a phrase, for a literal string rather than a paraphrase.
2. `read_node(id)` — full content and immediate connections, for the one that
   matters.
3. `traverse_graph(id, depth)` — what surrounds it.
4. `find_path(a, b)` — how two memories connect, when the link is not obvious.

Do this before answering anything that depends on context you do not have —
who someone is, why something was done this way, what was already tried.
Being asked twice is what they installed this to stop.

## Work, and upkeep

`status` (todo, doing, done, dropped) and `target_date` turn a memory into work
and put it on the roadmap. Set them on plans and issues only. Mark work
`dropped` rather than deleting it: what was decided against is worth as much
later as what was done.

`add_memory` refuses a write that duplicates something already here and hands
you the existing memory in full — fold anything new into it with
`update_memory`. `stale_memories()` lists what nothing has read since it was
written, for confirming, correcting or deleting.
""".strip()
