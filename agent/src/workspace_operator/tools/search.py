"""`hybrid_search` tool — search notes in the workspace by meaning or keyword."""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel, Field

from workspace_operator.client import PoggleClient


class HybridSearchInput(BaseModel):
    query: str = Field(description="Natural-language or keyword search query")
    limit: int = Field(default=8, ge=1, le=25, description="Max results to return")


class HybridSearchHit(BaseModel):
    note_id: str
    title: str
    snippet: str | None = None
    similarity: float | None = None
    match_type: str | None = None


class HybridSearchOutput(BaseModel):
    results: list[HybridSearchHit]


def build_hybrid_search_tool(client: PoggleClient) -> Any:
    """Return a `function_tool` closing over the per-run PoggleClient."""

    @function_tool(
        name_override="hybrid_search",
        description_override=(
            "Search the user's workspace for relevant notes. Combines semantic "
            "(vector) and keyword (full-text) ranking. Call this before drafting "
            "any note that depends on existing workspace content — every claim "
            "in a drafted note must be cited to a note_id returned by this tool."
        ),
    )
    async def hybrid_search(
        _ctx: RunContextWrapper[Any], args: HybridSearchInput
    ) -> HybridSearchOutput:
        results = await client.hybrid_search(query=args.query, limit=args.limit)
        return HybridSearchOutput(
            results=[
                HybridSearchHit(
                    note_id=r.note_id,
                    title=r.title,
                    snippet=r.snippet,
                    similarity=r.similarity,
                    match_type=r.match_type,
                )
                for r in results
            ]
        )

    return hybrid_search
