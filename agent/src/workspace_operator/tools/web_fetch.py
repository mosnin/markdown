"""`web_fetch` tool — fetch a public URL and return trimmed text.

The actual HTTP fetch happens server-side (Next.js endpoint) so the
SSRF guard, body-size cap, and timeout sit on the trusted side. The
Modal agent has no direct network egress to arbitrary URLs.
"""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel, Field

from workspace_operator.client import PoggleClient


class WebFetchInput(BaseModel):
    url: str = Field(
        min_length=1,
        description=(
            "Absolute http(s) URL to fetch. Private IPs, loopback, link-local "
            "(169.254.x), and non-http(s) schemes are rejected by the server."
        ),
    )


class WebFetchOutput(BaseModel):
    url: str
    final_url: str | None = None
    status: int
    content_type: str | None = None
    text: str
    truncated: bool = False


def build_web_fetch_tool(client: PoggleClient) -> Any:
    @function_tool(
        name_override="web_fetch",
        description_override=(
            "Fetch a public URL and return its body as plaintext. The body is "
            "stripped of HTML tags when possible and truncated to 32 KB. Use "
            "this when the user asks you to summarize an external article or "
            "page. Citations sourced from web fetches must reference the URL "
            "explicitly — they do not satisfy the `[[note_id]]` cite rule."
        ),
    )
    async def web_fetch(
        _ctx: RunContextWrapper[Any], args: WebFetchInput
    ) -> WebFetchOutput:
        result = await client.web_fetch(url=args.url)
        return WebFetchOutput(
            url=result["url"],
            final_url=result.get("final_url"),
            status=int(result["status"]),
            content_type=result.get("content_type"),
            text=result["text"],
            truncated=bool(result.get("truncated", False)),
        )

    return web_fetch
