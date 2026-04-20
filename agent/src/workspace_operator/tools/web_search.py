"""`web_search` tool — search the public web via Tavily.

Unlike `web_fetch` (which retrieves a specific URL), this tool takes a
natural-language query and returns a ranked list of result snippets
plus a synthesized answer. Use this when the user asks Pog to research
a topic and the agent doesn't already know a URL to fetch.

The actual Tavily call happens server-side (Next.js endpoint) so the
API key never touches the Modal container.
"""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel, Field

from workspace_operator.client import PoggleClient


class WebSearchInput(BaseModel):
    query: str = Field(
        min_length=1,
        description=(
            "Natural-language search query. Be specific — e.g. "
            "'2024 revenue for OpenAI' rather than just 'OpenAI'."
        ),
    )
    max_results: int = Field(
        default=5,
        ge=1,
        le=10,
        description="Number of results to return (1-10, default 5).",
    )
    include_answer: bool = Field(
        default=True,
        description=(
            "If true, Tavily synthesises a short answer across the top "
            "results — handy for factual queries."
        ),
    )


class WebSearchResult(BaseModel):
    title: str
    url: str
    content: str
    score: float = 0.0


class WebSearchOutput(BaseModel):
    query: str
    answer: str | None = None
    results: list[WebSearchResult]


def build_web_search_tool(client: PoggleClient) -> Any:
    @function_tool(
        name_override="web_search",
        description_override=(
            "Search the public web and return a ranked list of result "
            "snippets. Prefer this over `web_fetch` when you don't "
            "already know a URL. Follow up with `web_fetch` on the most "
            "promising URLs to read their full content. Web sources must "
            "be cited with their URL — they do not satisfy the "
            "`[[note_id]]` cite rule used for internal notes."
        ),
    )
    async def web_search(
        _ctx: RunContextWrapper[Any], args: WebSearchInput
    ) -> WebSearchOutput:
        result = await client.web_search(
            query=args.query,
            max_results=args.max_results,
            include_answer=args.include_answer,
        )
        raw_results = result.get("results") or []
        parsed: list[WebSearchResult] = []
        for r in raw_results:
            parsed.append(
                WebSearchResult(
                    title=str(r.get("title") or ""),
                    url=str(r.get("url") or ""),
                    content=str(r.get("content") or ""),
                    score=float(r.get("score") or 0.0),
                )
            )
        return WebSearchOutput(
            query=result.get("query", args.query),
            answer=result.get("answer"),
            results=parsed,
        )

    return web_search
