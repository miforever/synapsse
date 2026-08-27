#!/usr/bin/env python3
"""Catch the moment the user lays down a rule, and make it get written down.

Recall was the first half of the problem: agents do not search, so the search
was taken away from them and moved into a hook. Writing is the same failure in
the other direction. An agent mid-task is optimising for the task, and stopping
to record what it just learned is always the thing it drops - so the store ends
up holding whatever someone remembered to save, which is nothing.

The write side cannot be automated the same way, because the decision needs the
turn to have happened and it has side effects. What it can do is stop guessing
*when*. There is one moment that is both easy to detect and worth more than any
other: the user telling the agent how it should work from here on. Those are the
memories that change every future session - do not guess, never use em dashes,
that is not my name - and they arrive in a recognisable shape. No model needed
to spot them.

So this watches for that shape on the way out of a turn, and when it sees one it
declines to let the turn end, handing the agent a short instruction to record
what it was just told. The agent still does the writing, because it is the only
thing here that understands the exchange; it simply no longer decides whether to
bother.

Deliberately narrow. It fires on the phrasing of a standing instruction - from
now on, never, i prefer - and not on the phrasing of an in-task correction. "No,
wrong file" is the agent being steered, not taught, and a store that records
every steer is a store nobody can find anything in. Precision over recall,
because the cost of a false positive is a round trip the user is waiting on.

Firing is a question, not a verdict: the agent that answers it is free to decide
nothing here outlives the task and write nothing at all.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path

# Where the "already handled" marks live. Under the state directory rather than
# beside the code: it is per-machine scratch, not part of the tool.
STATE_DIR = Path(os.environ.get("SYNAPSSE_STATE_DIR", "~/.cache/synapsse")).expanduser()

# Longer than this and it is a pasted log, a stack trace, or a spec. Those are
# work, not instruction, whatever words happen to appear in them.
MAX_PROMPT_CHARS = 600

# Turned off without editing the hook out of the settings file.
ENABLED = os.environ.get("SYNAPSSE_CAPTURE", "1") not in {"0", "false", "no"}

# Phrases that mean the same thing wherever they appear in a sentence. Kept
# specific: "wrong" alone matches "what is wrong with this function", which is a
# question about code and not a correction of anything.
STRONG = re.compile(
    r"""
    that'?s\s+(wrong|not\s+right|incorrect)
  | you'?re\s+wrong
  | (that\s+is|this\s+is)\s+(wrong|incorrect)
  | (got|had|have)\s+(that|it|this)\s+wrong
  | i\s+(told|said\s+to)\s+you
  | i\s+already\s+(told|said)
  | from\s+now\s+on
  | going\s+forward
  | (never|always)\s+(use|do|write|say|call|add|include|forget)
  | no\s+need\s+(to|for)
  | (stop|quit)\s+(doing|using|adding|writing)
  | don'?t\s+(ever|again)
  | remember\s+(that|this|to)
  | (keep|bear)\s+in\s+mind
  | i\s+(prefer|hate|don'?t\s+like)
  | make\s+sure\s+(you|to)
  | for\s+future\s+reference
  | my\s+(preference|rule)\s+is
  # "my name is not Rosso", "my stack is not django" - a fact about them being
  # put right, which is worth more than most things they volunteer unprompted.
  | my\s+\w+\s+is\s+not\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

# An explicit request always wins, whatever else the message looks like.
EXPLICIT = re.compile(
    r"(remember|save|note)\s+(this|that|it)\b|add\s+(this|that)\s+to\s+(memory|the\s+store)",
    re.IGNORECASE,
)

# What the user sees. Claude Code prints a blocked stop under a fixed "Stop hook
# error:" label, so this line has to survive that prefix and say, in one breath,
# that nothing failed. The detail goes to the agent out of band, but this stays
# self-sufficient in case a build declines to carry it.
REASON = (
    "SYNAPSSE capture - not a failure. If what the user just said outlives this "
    "task, store it as a rule and say in one line what you stored; if it was a "
    "one-off fix, write nothing and stop."
)

INSTRUCTION = """\
SYNAPSSE: the user may have just told you something durable. Decide first.

Does it still hold next week, in another file, on another task? A one-off fix - \
this value, this file, this bug - is not a memory. Write nothing and end the turn.

If it does hold: search_index first, update_memory if something already covers \
it, otherwise store the rule rather than the incident, with their reason and \
their wording. One memory, one thing, linked to the person or project. Then say \
in one line what you stored."""


def _looks_like_instruction(text: str) -> bool:
    """Whether this message is telling the agent something durable.

    An explicit "remember this" always counts. Everything else has to carry the
    phrasing of a standing instruction, wherever in the sentence it sits.
    """
    if EXPLICIT.search(text):
        return True
    if len(text) > MAX_PROMPT_CHARS:
        return False
    return bool(STRONG.search(text))


def _last_user_message(transcript: Path) -> tuple[str, str] | None:
    """The last thing the user actually typed, with the id of that entry.

    A transcript's `user` entries are mostly not the user: tool results are
    recorded the same way and outnumber real messages twenty to one. What marks
    a genuine one is a `promptSource` and a plain string body, since a tool
    result carries a list of blocks instead.
    """
    try:
        lines = transcript.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None

    # Backwards: the answer is almost always in the last few entries, and these
    # files run to thousands of lines by the end of a session.
    for line in reversed(lines):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if entry.get("type") != "user" or not entry.get("promptSource"):
            continue
        content = entry.get("message", {}).get("content")
        if isinstance(content, str) and content.strip():
            return content, str(entry.get("uuid", ""))
    return None


def _already_handled(session: str, marker: str) -> bool:
    """Whether this exact message has already prompted a write.

    `stop_hook_active` covers the normal loop, but it is not the only way this
    can run twice over one message, and pestering the user about something
    already recorded is worse than missing it. Keyed by the message rather than
    the session, so the next correction still fires.
    """
    key = hashlib.sha256(f"{session}:{marker}".encode()).hexdigest()[:16]
    stamp = STATE_DIR / f"{key}.seen"
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        if stamp.exists():
            return True
        stamp.touch()
    except OSError:
        # No state directory means no memo, which is survivable. The loop guard
        # below is what actually prevents a runaway.
        return False
    return False


def main() -> int:
    if not ENABLED:
        return 0

    try:
        event = json.load(sys.stdin)
    except (ValueError, OSError):
        return 0
    if not isinstance(event, dict):
        return 0

    # The turn that follows this one ends in another Stop. Without this the two
    # would take it in turns forever.
    if event.get("stop_hook_active"):
        return 0

    path = event.get("transcript_path")
    if not isinstance(path, str) or not path:
        return 0

    found = _last_user_message(Path(path).expanduser())
    if found is None:
        return 0

    text, marker = found
    if not _looks_like_instruction(" ".join(text.split())):
        return 0
    if _already_handled(str(event.get("session_id", "")), marker):
        return 0

    json.dump(
        {
            "decision": "block",
            "reason": REASON,
            "hookSpecificOutput": {
                "hookEventName": "Stop",
                "additionalContext": INSTRUCTION,
            },
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    # A crash here must never strand a finished turn. Silence means "nothing to
    # do", which is the right default for every unforeseen case.
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
