"""Finding a memory."""

from fastapi import APIRouter

from app.core.database import db
from app.memories.models import NodeSearchResult
from app.search import service as search_service

router = APIRouter(tags=["search"])


@router.get("/search")
async def search(
    q: str, limit: int = 20, mode: search_service.SearchMode = "hybrid"
) -> list[NodeSearchResult]:
    """Search memories by keyword and meaning.

    Full-text and semantic rankings are fused, so exact terms and paraphrases
    both find their memory. `mode=keyword` turns the semantic half off for a
    caller who means the literal string; quoting a phrase in `q` matches it
    whole either way.
    """
    return await search_service.search(db.conn, q, limit, mode)
