"""What an agent is told about this server the moment it connects.

MCP hands the server a block of text in the initialize handshake, before any
tool is called. Tool descriptions can only say what one call does; this is the
only place that can say how the store is meant to be *shaped* — and shape is
the whole value of a graph. An agent left to guess writes long unlinked notes
and invents a class per noun, which produces a store that answers nothing.

It travels with the daemon rather than living in the user's project, so every
client that connects is working to the same conventions without anyone copying
a file around.
"""

INSTRUCTIONS = """
SYNAPSSE is a memory graph: a durable, connection-based store for what you
learn about the user and their work, so the next session starts warm.

## Record without being asked

Treat writing to this store as part of the work, not as a separate task the
user requests. You will almost never be told "remember this" — a user who has
to notice something is worth keeping, and then say so, is doing the job this
server exists to do for them. By the time they think to ask, the session where
it mattered is usually over.

Write a memory the moment one of these happens, not at the end of the session:

- They state a preference about how they work, or correct how you did it.
- A decision is made, especially one with a reason that is not obvious later.
- You learn something durable about a person, client or organization.
- A problem is diagnosed, and again when something actually fixes it.
- A constraint surfaces that will still be true next week.
- They change their mind about something previously decided.

Do not ask permission for each one; it interrupts the work and the answer is
always yes. Do not narrate every write either — mention it in a few words, or
not at all if you are mid-task. What does not belong: the conversation itself,
anything already in the code or git history, and anything only true for the
next ten minutes.

The opposite failure is worth naming: a store nobody wrote to is indistinguish-
able from no store at all, and the user cannot tell the difference until the
session they needed it.

## Before writing

Search first. A store with two memories of the same fact answers with
whichever it happens to rank first, and neither is trustworthy after that.

- `search_index(query)` — check whether this already exists.
- `update_memory` when a fact changed. Do not write a second memory that
  contradicts the first; the old one does not stop being returned.
- `list_types()` / `list_tags()` before inventing vocabulary. Reusing `person`
  is worth far more than a perfectly named class no other memory shares.

## Class and tags

Every memory has exactly one **class** — the coarse shape of the thing — and
any number of **tags**, which are the specifics.

The split is the part agents most often get wrong. A girlfriend is a `person`
tagged `girlfriend`, not a class of her own. A recurring argument is an `issue`
tagged with who it involves. Getting this right is what makes "show me every
person" and "show me everything tagged jealousy" both answerable; a class per
noun makes the first question useless and the second impossible.

Classes describe kinds of thing — `person`, `organization`, `place`, `object`,
`project`, `plan`, `issue`, `event`, `idea`, `fact`, `decision`, `preference`,
`resource`. Tags describe *this* one: a name, a role, a recurring theme, a
place it belongs to. When unsure which a word is, ask whether you would ever
want to list everything of that kind. If not, it is a tag.

New classes register themselves on first use, so a genuinely new shape costs
nothing — but reach for a tag first.

## One memory, one thing

A memory is a single claim, decision, person or event — not a session log.

A problem and what fixed it are two memories joined by an edge, not one note
titled "the X problem". Written separately they can be reached from either
side, the fix can be linked to the three other problems it also solved, and
superseding the fix later does not mean rewriting the history of the problem.

Fields carry different costs, so use them for what they are:

- `title` — how it appears on the canvas. Short and specific.
- `summary` — the one line agents read at index time. Make it carry the fact
  itself ("prefers being asked before advice"), not a description of the
  memory ("notes about communication"). This is what recall is paid for.
- `content` — the full Markdown: reasoning, quotes, detail.

## Connect it to something

An unlinked memory is nearly unreachable. Search finds it only if the words
happen to match; nothing leads to it from anywhere else, which is the one thing
this store does that a folder of notes does not.

When writing, link to what it is about — the person, the project, the decision
it followed from. Use the relation that is true:

- `depends_on` — this needs that first.
- `blocks` — this is stopping that.
- `part_of` — this belongs inside that.
- `relates_to` — the honest fallback when the link is real but unstructured.

Prefer the specific one. `relates_to` everywhere carries no more information
than no edge at all, and the roadmap ignores it precisely for that reason.

Link across topics, not only within them. The same trait explaining a
disagreement with one person and a delay on a project is exactly the connection
worth having recorded; it is also the one nobody thinks to write down.

## Reading

Work outside in, and stop as soon as you have enough:

1. `search_index(query)` — id, title and summary only. Add `mode="keyword"`, or
   quote a phrase, when you want a literal string rather than a paraphrase.
2. `read_node(id)` — full content and immediate connections, for the one that
   matters.
3. `traverse_graph(id, depth)` — what surrounds it.
4. `find_path(a, b)` — how two memories are connected, when the link is not
   obvious. This is the question the graph exists to answer.

Fetching everything defeats the point: the store is cheap because you read the
index and then one node, not because it holds less.

## Work

`status` (todo, doing, done, dropped) and `target_date` turn a memory into
work, and put it on the roadmap. Set them on plans and issues only — a fact is
not "todo", and a person is not "done".

Mark work `dropped` rather than deleting it. What was decided against, and why,
is worth as much later as what was done.

## Reading, unprompted

The same applies in reverse. Before answering anything that depends on context
you do not have — who someone is, why something was done this way, what was
already tried — search the store first rather than asking the user to repeat
themselves. Being asked twice is the thing they installed this to stop.

## What is worth remembering

Things that stay true and cost something to rediscover: how the user works and
what they prefer, decisions and the reasons behind them, people and how they
relate, problems that recur and what actually resolved them.

Not: what is already in the code or the git history, and not the conversation
itself. If it is only true for the next ten minutes, it is not a memory.
""".strip()
