"""The FastMCP instance, isolated so tool modules can import it without a cycle."""

from fastmcp import FastMCP

from app.mcp.guidance import INSTRUCTIONS

mcp: FastMCP = FastMCP("synapsse", instructions=INSTRUCTIONS)
