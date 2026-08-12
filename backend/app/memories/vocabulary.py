"""What vocabulary already exists, so agents reuse it.

One call rather than three. Classes, tags and the canvas's render switches are
all things an agent wants before it writes, and asking for them separately cost
three round trips and three tool definitions in every session's context.
"""

from app.canvas import settings as settings_service
from app.core.database import db
from app.core.fields import NODE_CLASSES
from app.mcp.instance import mcp
from app.memories import tags as tags_service


@mcp.tool
async def list_vocabulary() -> dict[str, object]:
    """The classes a memory can take, the tags in use, and what the canvas renders.

    `classes` is fixed — those thirteen are all there are, and a word that is
    not among them becomes a tag. `tags` is open and comes with usage counts:
    reuse one that is already carrying memories rather than minting a synonym
    beside it. `renders` says which attachments the canvas will display, so
    nothing is attached that nobody can open.
    """
    return {
        "classes": list(NODE_CLASSES),
        "tags": [tag.model_dump() for tag in await tags_service.list_tags(db.conn)],
        "renders": (await settings_service.get_settings(db.conn)).model_dump(),
    }
