"""What a memory is, and how memories join to each other.

Nodes carry the content, edges carry the relationships, and both are declared
here because neither is meaningful without the other.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.attachments.models import FileOut, SourceOut
from app.core.base import TimestampedModel
from app.core.fields import (
    NodeType,
    RelationType,
    Status,
    Summary,
    TagName,
    TargetDate,
    Title,
    Weight,
)


class NodeCreate(BaseModel):
    type: NodeType
    title: Title
    summary: Summary
    content: str = ""
    thumbnail_url: str | None = None
    status: Status | None = None
    target_date: TargetDate | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    tags: list[TagName] = Field(default_factory=list)


class NodeUpdate(BaseModel):
    """Partial update. Omitted fields keep their stored value.

    `tags` is replace-not-merge: passing [] clears them, omitting it leaves
    them alone. Without that distinction there is no way to remove a tag.
    """

    type: NodeType | None = None
    title: Title | None = None
    summary: Summary | None = None
    content: str | None = None
    thumbnail_url: str | None = None
    status: Status | None = None
    target_date: TargetDate | None = None
    metadata: dict[str, Any] | None = None
    tags: list[TagName] | None = None


class NodeOut(TimestampedModel):
    id: str
    type: str
    title: str
    summary: str
    content: str
    thumbnail_url: str | None
    status: Status | None = None
    target_date: str | None = None
    metadata: dict[str, Any]
    tags: list[str]
    # Carried with the memory rather than fetched separately: the drawer needs
    # them the moment it opens, and content can reference them inline.
    files: list[FileOut] = Field(default_factory=list)
    # What the memory cites. Ordered, because the text refers to them by
    # number.
    sources: list[SourceOut] = Field(default_factory=list)


class NodeSearchResult(BaseModel):
    """Deliberately narrow: the index read agents pay tokens for."""

    id: str
    type: str
    title: str
    summary: str


class EdgeCreate(BaseModel):
    source_id: str
    target_id: str
    relation_type: RelationType
    weight: Weight = 1.0


class EdgeOut(BaseModel):
    id: str
    source_id: str
    target_id: str
    relation_type: RelationType
    weight: float
    created_at: datetime


class PathOut(BaseModel):
    """How two memories are connected: the nodes walked, and the edges between.

    `edges[i]` joins `nodes[i]` to `nodes[i + 1]`, so there is always one fewer
    edge than node. Which way round an edge points is left to be read off its
    own source_id — a path is walked in one direction, but `depends_on` means
    the opposite thing when it is traversed backwards, and flattening that away
    would make the chain read wrong.

    Both lists are empty when nothing links the two within the depth searched.
    """

    nodes: list[NodeSearchResult] = Field(default_factory=list)
    edges: list[EdgeOut] = Field(default_factory=list)


class TagOut(BaseModel):
    name: str
    count: int
