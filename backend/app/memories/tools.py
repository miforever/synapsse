"""Reading and writing memories — the progressive disclosure path.

Agents work index -> fetch -> traverse so recall costs a fraction of the
context that replaying a transcript would.
"""

import logging

from app.attachments import files as files_service
from app.attachments import sources as sources_service
from app.attachments.models import SourceCreate
from app.core.database import db
from app.mcp.instance import mcp
from app.memories import edges as edges_service
from app.memories import nodes as nodes_service
from app.memories import paths as paths_service
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
    linked_to: list[str] | None = None,
    tags: list[str] | None = None,
    files: list[str] | None = None,
    sources: list[str] | None = None,
    status: str | None = None,
    target_date: str | None = None,
) -> dict[str, object]:
    """Persist a new memory, its tags, and optional edges to existing nodes.

    Search first: a second memory of the same fact does not replace the first,
    it competes with it. Use update_memory when something changed.

    `type` is the memory's class — the coarse shape of the thing (person,
    project, issue, decision, fact, preference...). Everything specific about
    this one belongs in `tags` instead. A girlfriend is a person tagged
    `girlfriend`, not a class of her own; a recurring argument is an issue
    tagged with who it involves. An unrecognized `type` is registered rather
    than rejected, so call list_types() and list_tags() first and reuse what
    is there — a shared class is worth more than an exact one.

    Keep a memory to a single thing. A problem and what fixed it are two
    memories with an edge between them, not one note about both: that way the
    fix can also be linked to the other problems it solved, and revising it
    later does not rewrite the history of the problem.

    `summary` is the one line other agents read at index time — put the fact in
    it ("prefers being asked before advice"), not a description of the memory
    ("notes on communication"). `content` takes the reasoning and the detail.

    `linked_to` connects this to what it is about — the person, the project,
    the decision it followed from. An unlinked memory is nearly unreachable.
    These edges are `relates_to`; call link_memories afterwards for the more
    specific depends_on, blocks or part_of, which are the ones that carry
    meaning.

    `files` are paths on this machine, copied into the daemon's own store.
    Mention one from `content` as `[[file:NAME]]` and the canvas renders it
    where you wrote it, as something the reader can open.

    `sources` are the URLs this memory was written from, cited in order and
    referred to from `content` as `[[src:1]]`. Use cite_source instead when you
    have the page's title and the line you took from it — those are what make a
    citation worth following.

    `status` (todo, doing, done, dropped) and `target_date` (YYYY-MM-DD) mark a
    memory as work with a state. Set them on plans and issues, and leave them
    off everything else — a fact is not "todo". Memories carrying a status
    appear on the roadmap.
    """
    # Before anything is written: the foreign key catches an unknown target
    # only after the node is committed, and the caller retries a write that
    # actually landed.
    if unknown := await nodes_service.missing_ids(db.conn, linked_to or []):
        return {
            "error": "No memory with these ids: " + ", ".join(unknown),
            "hint": "search_index for the right id, or omit linked_to and "
            "connect the memory afterwards with link_memories.",
            "written": False,
        }

    node = await nodes_service.create_node(
        db.conn,
        NodeCreate(
            type=type,
            title=title,
            summary=summary,
            content=content,
            tags=tags or [],
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
                source_id=node.id, target_id=target_id, relation_type="relates_to"
            ),
        )
        for target_id in linked_to or []
    ]

    # Re-read so the broadcast and the response carry the attachments.
    stored = await nodes_service.get_node(db.conn, node.id) or node
    await broadcast_new_node(stored, created)
    return {
        "node": stored.model_dump(mode="json"),
        "edges": [edge.model_dump(mode="json") for edge in created],
        "files": [item.model_dump(mode="json") for item in attached],
        "sources": [item.model_dump(mode="json") for item in cited],
    }


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
async def set_status(
    node_id: str, status: str, target_date: str | None = None
) -> dict[str, object] | None:
    """Mark where a piece of work stands: todo, doing, done or dropped.

    The operation worth its own tool, because it is the one an agent performs
    while doing something else — finishing a task should cost one call, not a
    read and a general update.

    `dropped` rather than deleting: what was decided against, and why, is worth
    as much later as what was done. Returns None if the memory does not exist.
    """
    node = await nodes_service.update_node(
        db.conn,
        node_id,
        NodeUpdate.model_validate(
            {"status": status, **({"target_date": target_date} if target_date else {})}
        ),
    )
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
) -> dict[str, object]:
    """Connect two existing memories.

    Pick the relation that is true: `depends_on` (this needs that first),
    `blocks` (this is stopping that), `part_of` (this belongs inside that), or
    `relates_to` when the link is real but unstructured. Prefer a specific one
    — `relates_to` everywhere says little more than no edge at all, and the
    roadmap ignores it for exactly that reason.

    Worth linking across topics, not only within them: the trait that explains
    both a disagreement with someone and a delay on a project is the connection
    this store exists to hold, and the one nobody writes down.
    """
    if unknown := await nodes_service.missing_ids(db.conn, [source_id, target_id]):
        return {"error": "No memory with these ids: " + ", ".join(unknown)}

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
async def unlink_memories(edge_id: str) -> dict[str, object]:
    """Remove a connection between two memories, leaving both in place."""
    return {"deleted": await edges_service.delete_edge(db.conn, edge_id)}
