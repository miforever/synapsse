#!/usr/bin/env python3
"""Catch the moment the user corrects the agent, and make it get written down.

Recall was the first half of the problem: agents do not search, so the search
was taken away from them and moved into a hook. Writing is the same failure in
the other direction. An agent mid-task is optimising for the task, and stopping
to record what it just learned is always the thing it drops - so the store ends
up holding whatever someone remembered to save, which is nothing.

The write side cannot be automated the same way, because the decision needs the
turn to have happened and it has side effects. What it can do is stop guessing
*when*. There is one moment that is both easy to detect and worth more than any
other: the user correcting the agent, or telling it how to behave. Those are the
memories that change every future session - do not guess, never use em dashes,
that is not my name - and they arrive in a recognisable shape. No model needed
to spot them.

So this watches for that shape on the way out of a turn, and when it sees one it
declines to let the turn end, handing the agent a short instruction to record
what it was just told. The agent still does the writing, because it is the only
thing here that understands the exchange; it simply no longer decides whether to
bother.

Deliberately narrow. It fires on corrections and standing instructions and
nothing else, so a turn that taught nobody anything ends immediately. Precision
over recall, because the cost of a false positive is a round trip the user is
waiting on, and the cost of a store full of noise is that recall stops being
worth injecting at all.
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
STATE_DIR = Path(
    os.environ.get("SYNAPSSE_STATE_DIR", "~/.cache/synapsse")
).expanduser()

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
  # Ambiguous on its own: "the test shouldn't fail" is debugging, not
  # instruction. Admitted anyway because a false fire costs one round trip in
  # which the agent finds nothing worth writing, while a miss loses the rule
  # for good.
  | should\s?n'?t\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Words that only mean correction when the message opens with them. Mid-sentence
# they are ordinary English: "no" in "no idea", "not" in "not sure if this is".
LEADING = re.compile(
    r"""^\W*(
    # "no" opens a correction, but it also opens "no idea", "no worries" and
    # "no rush", none of which are one.
      no+(?!\s*(idea|clue|problem|worries|rush|thanks|thank))[,.!\s]
    | nope
    | wrong\b
    | nah\b
    | actually[,\s]
    | incorrect\b
    | (that'?s|it'?s|its)\s+not\b
    | not\s+(like\s+)?that
    | don'?t\b
    | never\b
    | always\b
    | stop\b
    )""",
    re.IGNORECASE | re.VERBOSE,
)

# An explicit request always wins, whatever else the message looks like.
EXPLICIT = re.compile(
    r"(remember|save|note)\s+(this|that|it)\b|add\s+(this|that)\s+to\s+(memory|the\s+store)",
    re.IGNORECASE,
)

INSTRUCTION = """\
The user just corrected you or told you how they want you to work. That is the \
single most valuable kind of thing this store holds, and it is about to be lost \
when this turn ends.

Record it in SYNAPSSE now, then continue:

1. search_index for what they just told you. If a memory already covers it, \
update_memory rather than adding a second one that says nearly the same thing.
2. Write the rule, not the incident. "Wants X, because Y" outlives "asked for X \
at 10pm on Tuesday". Include the reason when they gave one, and quote them when \
the wording matters.
3. One memory, one thing. Class it as `preference` for how they want to be \
worked with, `constraint` for a hard rule, `decision` for a choice with a \
reason behind it.
4. Link it to the person or project it is about, or it will be unreachable.

If it turns out they were correcting a fact about themselves rather than your \
behaviour, fix the memory that held the wrong fact instead of writing a new one.

Do not announce any of this. Write it, then answer whatever is still \
outstanding, or stop if nothing is."""


def _looks_like_instruction(text: str) -> bool:
    """Whether this message is telling the agent something durable.

    Three tests rather than one list, because the same word carries different
    weight depending on where it sits: an explicit "remember this" always
    counts, some phrases count anywhere, and the rest only count when the
    message opens with them.
    """
    if EXPLICIT.search(text):
        return True
    if len(text) > MAX_PROMPT_CHARS:
        return False
    return bool(STRONG.search(text) or LEADING.match(text))


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

    json.dump({"decision": "block", "reason": INSTRUCTION}, sys.stdout)
    return 0


if __name__ == "__main__":
    # A crash here must never strand a finished turn. Silence means "nothing to
    # do", which is the right default for every unforeseen case.
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
