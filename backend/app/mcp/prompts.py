"""Prompts the user reaches for by name.

The server `instructions` are always in context and so must stay short enough
to be worth their room. A prompt is the opposite: nothing until it is asked
for, and then as specific as the moment needs. These are the two jobs where
getting the shape right matters most and the cost of getting it wrong is
paid much later — writing something down, and going looking for it.
"""

from app.mcp.instance import mcp


@mcp.prompt
def remember(what: str) -> str:
    """Capture something into the memory graph with the right shape."""
    return f"""
Record this in SYNAPSSE:

{what}

Work in this order, and do not skip the first step:

1. `search_index` for it first. If a memory already covers it, `update_memory`
   rather than writing a second one — two memories of the same fact leave
   neither trustworthy.
2. `list_types()` and `list_tags()`, and reuse what is there. A shared class is
   worth more than an exact one.
3. Split it if it is more than one thing. A person and the problem involving
   them are two memories; a problem and its fix are two more. Each gets a
   `summary` that states the fact itself, so it is useful without opening it.
4. Write it, then connect it — to the person it is about, the project it came
   from, the decision it followed. Use `depends_on`, `blocks` or `part_of`
   where one of them is true; `relates_to` only when none is.
5. Look for a link across topics before you stop. The trait that explains both
   an argument and a missed deadline is the connection worth recording, and the
   one that never gets written down.

Say what you stored and what you linked it to, briefly.
""".strip()


@mcp.prompt
def recall(question: str) -> str:
    """Answer from the memory graph, reading as little of it as possible."""
    return f"""
Answer this from SYNAPSSE:

{question}

Read outside in and stop as soon as you can answer:

1. `search_index` — titles and summaries only. Quote a phrase, or pass
   `mode="keyword"`, when you are after a literal string.
2. `read_node` on the one that matters, not on all of them.
3. `traverse_graph` for what surrounds it, or `find_path` between two memories
   when the question is how they relate.

Answer from what the graph says, and say plainly when it does not say. If you
find the store is wrong or out of date, correct it with `update_memory` rather
than working around it.
""".strip()
