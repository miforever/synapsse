"""Assembles the MCP surface.

Importing the tool modules is what registers them against the instance, so
this is also the list of what agents can do. Each package owns its own tools;
this only says which packages are exposed.
"""

from app.attachments import tools as attachment_tools
from app.mcp import prompts as mcp_prompts
from app.mcp.instance import mcp
from app.memories import tools as memory_tools
from app.memories import vocabulary
from app.search import tools as search_tools

__all__ = [
    "attachment_tools",
    "mcp",
    "mcp_prompts",
    "memory_tools",
    "search_tools",
    "vocabulary",
]
