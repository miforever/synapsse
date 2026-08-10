"""Reading and writing memories — the progressive disclosure path.

Agents work index -> fetch -> traverse so recall costs a fraction of the
context that replaying a transcript would.
"""

import logging
from typing import get_args

from app.attachments import files as files_service
from app.attachments import sources as sources_service
from app.attachments.models import SourceCreate
from app.core.database import db
from app.core.fields import RelationType
from app.core.identifiers import utcnow_shifted
from app.mcp.instance import mcp
from app.memories import duplicates
from app.memories import edges as edges_service
from app.memories import nodes as nodes_service
from app.memories import paths as paths_service
from app.memories import types as types_service
from app.memories.models import EdgeCreate, NodeCreate, NodeUpdate
from app.ws.events import (
    broadcast_new_node,
    broadcast_node_deleted,
    broadcast_node_updated,
)

logger = logging.getLogger(__name__)


async def _announce(node_id: str) -> None:
    """Tell every open canvas the memory changed.

    Re-read rather than passed in: what a tool holds after writing is the file
    or source, not the memory carrying it, and canvases redrawing from a stale
    node would drop the very thing that prompted the broadcast.
    """
    node = await nodes_service.get_node(db.conn, node_id)
    if node is not None:
        await broadcast_node_updated(node)


@mcp.tool
async def read_node(node_id: str) -> dict[str, object] | None:
    """Fetch a node's full Markdown content and its immediate connections."""
    node = await nodes_service.get_node(db.conn, node_id)
    if node is None:
        return None
    await nodes_service.mark_read(db.conn, node_id)
    connections = await edges_service.list_edges_for_node(db.conn, node_id)
    return {
        "node": node.model_dump(mode="json"),
        "edges": [edge.model_dump(mode="json") for edge in connections],
    }


@mcp.tool
async def traverse_graph(node_id: str, depth: int = 1) -> dict[str, list[str]]:
    """Walk N steps outward to build a localized structural map."""
    return await edges_service.traverse_graph(db.conn, node_id, depth)


@mcp.tool
async def find_path(
    source_id: str, target_id: str, max_depth: int = paths_service.DEFAULT_DEPTH
) -> dict[str, object]:
    """Explain how two memories are connected, by the shortest route between.

    The question traverse_graph cannot answer: not what is near a memory, but
    what stands between this one and that one — the decision behind an issue,
    the person behind a project. Returns the chain of memories with the edges
    joining them, id/title-sized; read_node whichever link matters.

    Empty when nothing connects them within max_depth. Edges are followed in
    both directions, since how two memories relate does not depend on which of
    them happened to be written first.
    """
    path = await paths_service.path_between(db.conn, source_id, target_id, max_depth)
    return path.model_dump(mode="json")


@mcp.tool
async def add_memory(
    title: str,
    summary: str,
    content: str,
    type: str,
    linked_to: list[dict[str, str]] | None = None,
    tags: list[str] | None = None,
    files: list[str] | None = None,
    sources: list[str] | None = None,
    status: str | None = None,
    target_date: str | None = None,
    force: bool = False,
) -> dict[str, object]:
    """Persist a new memory, its tags, and edges to memories it is about.

    Refuses a write that would duplicate a memory already here, answering with
    the one it found and its full content so you can fold anything new into it
    with update_memory instead. Pass force=True only when you have read that
    memory and the two really are separate facts.

    `type` is the memory's class, from a fixed set: person, organization,
    place, object, project, plan, issue, event, idea, fact, decision,
    preference, resource. Anything specific about this particular memory is a
    tag instead — a girlfriend is a `person` tagged `girlfriend`, a recurring
    argument an `issue` tagged with who it involves. A word that is not a class
    is kept as a tag rather than rejected, and the response says so.

    Keep a memory to a single thing. A problem and what fixed it are two
    memories with an edge between them, not one note about both: that way the
    fix can also be linked to the other problems it solved, and revising it
    later does not rewrite the history of the problem.

    `summary` is the one line other agents read at index time, and the line a
    recall hook puts in front of them — put the fact in it ("prefers being
    asked before advice"), not a description of the memory ("notes on
    communication"). `content` takes the reasoning and the detail.

    `linked_to` connects this to what it is about, each entry `{"id": ...,
    "relation": ...}`. Relations are `depends_on` (this needs that first),
    `part_of` (this belongs inside that), and `relates_to` for a link that is
    real but unstructured. Omitting `relation` means `relates_to`; prefer a
    specific one, since the roadmap ignores `relates_to` and an unlinked
    memory is nearly unreachable.

    `files` are paths on this machine, copied into the daemon's own store.
    Mention one from `content` as `[[file:NAME]]` and the canvas renders it
    where you wrote it.

    `sources` are URLs this memory was written from, cited in order and
    referred to as `[[src:1]]`. Use cite_source instead when you have the
    page's title and the line you took from it.

    `status` (todo, doing, done, dropped) and `target_date` (YYYY-MM-DD) mark a
    memory as work and put it on the roadmap. Set them on plans and issues, and
    leave them off everything else — a fact is not "todo".
    """
    links = _parse_links(linked_to)
    if isinstance(links, str):
        return {"error": links, "written": False}

    if unknown := await nodes_service.missing_ids(db.conn, [link[0] for link in links]):
        return {
            "error": "No memory with these ids: " + ", ".join(unknown),
            "hint": "search_index for the right id, or leave linked_to out and "
            "connect the memory afterwards with link_memories.",
            "written": False,
        }

    if not force and (
        found := await duplicates.find_duplicate(db.conn, title, summary)
    ):
        existing, score = found
        full = await nodes_service.get_node(db.conn, existing.id)
        return {
            "written": False,
            "duplicate_of": full.model_dump(mode="json") if full else None,
            "similarity": round(score, 3),
            "hint": "This looks like a memory that already exists, returned in "
            "full above. Fold anything new into it with update_memory. If they "
            "really are two facts, call again with force=True.",
        }

    coerced = types_service.coerce_class(type, list(tags or []))
    node = await nodes_service.create_node(
        db.conn,
        NodeCreate(
            type=coerced.type,
            title=title,
            summary=summary,
            content=content,
            tags=coerced.tags,
            status=status,  # type: ignore[arg-type]
            target_date=target_date,
        ),
    )

    attached = []
    for source in files or []:
        try:
            attached.append(await files_service.attach_path(db.conn, node.id, source))
        except (FileNotFoundError, files_service.FileTooLarge):
            # One unreachable path must not lose the memory that was just
            # written. The response says what was stored; the caller can see
            # what is missing from it.
            logger.warning("Could not attach %s to %s", source, node.id)

    cited = []
    for url in sources or []:
        try:
            cited.append(
                await sources_service.cite(db.conn, node.id, SourceCreate(url=url))
            )
        except sources_service.UnusableSource:
            logger.warning("Ignoring unusable source %s on %s", url, node.id)

    created = [
        await edges_service.create_edge(
            db.conn,
            EdgeCreate(
                source_id=node.id,
                target_id=target_id,
                relation_type=relation,  # type: ignore[arg-type]
            ),
        )
        for target_id, relation in links
    ]

    # Re-read so the broadcast and the response carry the attachments.
    stored = await nodes_service.get_node(db.conn, node.id) or node
    await broadcast_new_node(stored, created)
    return {
        "written": True,
        "node": stored.model_dump(mode="json"),
        "edges": [edge.model_dump(mode="json") for edge in created],
        "files": [item.model_dump(mode="json") for item in attached],
        "sources": [item.model_dump(mode="json") for item in cited],
        **({"notice": coerced.notice} if coerced.notice else {}),
    }


def _parse_links(
    linked_to: list[dict[str, str]] | None,
) -> list[tuple[str, str]] | str:
    """Read `linked_to` into (id, relation) pairs, or return why it cannot be.

    Accepts a bare id string per entry as well as the mapping, because that is
    what the tool used to take and agents copy older examples of themselves.
    """
    pairs: list[tuple[str, str]] = []
    for entry in linked_to or []:
        if isinstance(entry, str):
            pairs.append((entry, "relates_to"))
            continue
        if not isinstance(entry, dict) or "id" not in entry:
            return 'Each linked_to entry needs an id, as {"id": ..., "relation": ...}.'
        relation = entry.get("relation") or "relates_to"
        if relation not in get_args(RelationType):
            return (
                f"{relation!r} is not a relation. Use "
                + ", ".join(get_args(RelationType))
                + "."
            )
        pairs.append((entry["id"], relation))
    return pairs


@mcp.tool
async def update_memory(
    node_id: str,
    title: str | None = None,
    summary: str | None = None,
    content: str | None = None,
    type: str | None = None,
    tags: list[str] | None = None,
    status: str | None = None,
    target_date: str | None = None,
) -> dict[str, object] | None:
    """Correct an existing memory. Omitted fields are left untouched.

    Passing `tags` replaces the whole set, so send the full list rather than
    just the additions. Returns None if the memory no longer exists.
    """
    patch = NodeUpdate.model_validate(
        {
            key: value
            for key, value in {
                "title": title,
                "summary": summary,
                "content": content,
                "type": type,
                "tags": tags,
                "status": status,
                "target_date": target_date,
            }.items()
            if value is not None
        }
    )

    node = await nodes_service.update_node(db.conn, node_id, patch)
    if node is None:
        return None

    await broadcast_node_updated(node)
    return {"node": node.model_dump(mode="json")}


@mcp.tool
async def read_roadmap() -> list[dict[str, str | None]]:
    """Every memory carrying a status, soonest first.

    The cheap read for "what is in flight" — id, title, status and target date
    only. Follow up with read_node on whichever one matters.
    """
    return await nodes_service.list_roadmap(db.conn)


@mcp.tool
async def delete_memory(node_id: str) -> dict[str, object]:
    """Remove a memory and every edge touching it.

    Use this for memories that turned out to be wrong; a store you cannot
    correct accumulates confidently stated mistakes.
    """
    deleted = await nodes_service.delete_node(db.conn, node_id)
    if deleted:
        await broadcast_node_deleted(node_id)
    return {"deleted": deleted, "node_id": node_id}


@mcp.tool
async def link_memories(
    source_id: str,
    target_id: str,
    relation_type: str = "relates_to",
    weight: float = 1.0,
    remove: bool = False,
) -> dict[str, object]:
    """Connect two memories, or with remove=True take the connection away.

    Pick the relation that is true: `depends_on` (this needs that first),
    `part_of` (this belongs inside that), or `relates_to` when the link is real
    but unstructured. Prefer a specific one — `relates_to` everywhere says
    little more than no edge at all, and the roadmap ignores it for exactly
    that reason.

    There is no `blocks`: it is `depends_on` with the ends swapped, and having
    both meant one situation could be recorded two ways.

    Worth linking across topics, not only within them: the trait that explains
    both a disagreement with someone and a delay on a project is the connection
    this store exists to hold, and the one nobody writes down.
    """
    if unknown := await nodes_service.missing_ids(db.conn, [source_id, target_id]):
        return {"error": "No memory with these ids: " + ", ".join(unknown)}

    if remove:
        return {
            "removed": await edges_service.delete_between(
                db.conn, source_id, target_id, relation_type
            )
        }

    edge = await edges_service.create_edge(
        db.conn,
        EdgeCreate(
            source_id=source_id,
            target_id=target_id,
            relation_type=relation_type,  # type: ignore[arg-type]
            weight=weight,
        ),
    )
    return {"edge": edge.model_dump(mode="json")}


@mcp.tool
async def stale_memories(days: int = 90, limit: int = 20) -> list[dict[str, object]]:
    """Memories written more than `days` ago that nothing has opened since.

    The store only grows, and ranking gets worse as it fills with rows nobody
    wants. This is the list to review: confirm what still holds, update what
    changed, delete what turned out to be wrong.

    Never-read is the only signal used. Age on its own says nothing — a note
    about how someone likes to be given feedback can be two years old and the
    most useful row here — and anything being read regularly is left alone
    however old it is.
    """
    before = utcnow_shifted(-days)
    return await nodes_service.list_stale(db.conn, before, limit)
