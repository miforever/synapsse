"""Reusable annotated field types shared across the model modules."""

from typing import Annotated, Literal

from pydantic import BeforeValidator, Field

from app.core.slug import slugify

# The classes a memory can be, and the only ones.
#
# Open vocabulary was the wrong trade. Registering an unrecognised class on
# first use meant no write was ever lost, but it also meant "show me every
# person" degraded a little every time an agent reached for `client`, `friend`
# or `colleague` — and it took two hundred words of instructions to talk agents
# out of doing exactly that. A closed set enforces in the schema what the prose
# was asking for, and adding one becomes a deliberate release rather than an
# improvisation at two in the morning.
#
# Levelled on purpose, which is the part that took two attempts. Siblings must
# not be able to swallow one another: `fact` could always be said of a
# preference or a decision ("it is a fact that they prefer..."), so it was not
# their sibling but their parent, and every ambiguous memory drifted up into it
# until it held half the store. It is `finding` now — something learned, with
# evidence — which is a peer of `decision` rather than a roof over it.
#
# `person` and `creature` set the granularity. Anything broader than those two
# is a family, not a class, and belongs split.
NODE_CLASSES: tuple[str, ...] = (
    # Beings
    "person",
    "creature",
    # Groups
    "organization",
    # Places
    "place",
    # Things
    "object",
    "device",
    "document",
    # Happenings
    "event",
    # Work
    "project",
    "plan",
    "issue",
    # Positions held
    "decision",
    "preference",
    "constraint",
    "finding",
    "idea",
)

# Where an unrecognised class lands.
#
# `finding` because it claims the least about shape while still being true: the
# agent learned something. The word it reached for is kept as a tag, so nothing
# it meant is lost — the guess that would be worse than useless is silently
# filing a person under something confident and wrong.
FALLBACK_CLASS = "finding"

NodeType = Annotated[str, BeforeValidator(slugify), Field(max_length=40)]
TagName = Annotated[str, BeforeValidator(slugify), Field(max_length=40)]

# How memories connect.
#
# `blocks` is gone: blocks(A, B) and depends_on(B, A) are the same edge said
# backwards, so two agents encoded identical situations two ways and every
# reader — find_path, the roadmap, the canvas — had to normalise before it
# could answer. One direction, rendered either way round in the UI.
RelationType = Literal["depends_on", "relates_to", "part_of"]

# Where a piece of work stands. Closed, like relations and now like classes:
# these four are the states a roadmap can draw, and a fifth invented at runtime
# would have nowhere to appear.
#
# `dropped` rather than deleting the memory: what you decided not to do, and
# why, is worth as much later as what you did.
Status = Literal["todo", "doing", "done", "dropped"]

# A day, not a timestamp. Plans land on dates; pretending to know the hour is
# false precision that then has to be rendered away again.
TargetDate = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]

Title = Annotated[str, Field(max_length=100)]
Summary = Annotated[str, Field(max_length=250)]
Weight = Annotated[float, Field(ge=0.0, le=1.0)]
