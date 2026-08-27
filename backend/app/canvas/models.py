"""What the canvas reads: the graph as drawn, and the state of the views.

Deliberately lighter than the memory models — enough to draw and label a node,
with the full record fetched only when one is opened. Link fields are named
`source`/`target` because that is what the force-graph renderer expects,
sparing the client a transform pass over every edge.
"""

from typing import Literal

from pydantic import BaseModel, Field

from app.core.fields import RelationType, Status


class GraphNode(BaseModel):
    id: str
    type: str
    title: str
    summary: str
    thumbnail_url: str | None = None
    tags: list[str] = []
    # Carried in the snapshot rather than fetched per node: the roadmap draws
    # every plan at once, and reading each one to find out whether it is done
    # would be the N+1 that view exists to avoid.
    status: Status | None = None
    target_date: str | None = None


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    relation_type: RelationType
    weight: float


class GraphSnapshot(BaseModel):
    """The graph, whole or as a delta.

    A client caching the graph passes back `as_of` from its last read and gets
    only what has changed since — including `deleted`, without which a removed
    memory would sit on its canvas until a full reload. On a full read the list
    is empty and there is nothing to reconcile.
    """

    nodes: list[GraphNode]
    edges: list[GraphEdge]
    deleted: list[str] = []
    # The moment this snapshot describes. Pass it back as `since` next time —
    # taken from the database's own clock, so a client whose clock is skewed
    # cannot ask for a window that never closes.
    as_of: str
    # False when the reply is a delta, so a client that has lost its cache
    # knows it cannot treat this as the whole graph.
    complete: bool = True


CanvasMode = Literal["2d", "3d"]


MAX_PINNED = 20_000


class Position(BaseModel):
    x: float
    y: float
    # Absent in 2D, where the canvas has no depth.
    z: float | None = None


class Layout(BaseModel):
    mode: CanvasMode
    positions: dict[str, Position] = Field(default_factory=dict, max_length=MAX_PINNED)


class LayoutUpdate(BaseModel):
    positions: dict[str, Position] = Field(default_factory=dict, max_length=MAX_PINNED)


class MediaSettings(BaseModel):
    images: bool = True
    # Off by default: audio and video render as a click-to-load placeholder
    # instead of pulling media the moment a node is opened.
    audio: bool = False
    video: bool = False
    # When false, only same-origin and data URLs load; remote hosts are shown
    # as plain links so opening a memory never phones out.
    remote_content: bool = False


class Settings(BaseModel):
    media: MediaSettings = Field(default_factory=MediaSettings)


class SettingsPatch(BaseModel):
    """Partial update; omitted fields keep their stored value."""

    media: MediaSettings | None = None
