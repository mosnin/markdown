"""HTTP client for calling back into the Poggle Next.js app.

Every tool the Workspace Operator exposes to the LLM resolves to one of
these methods. The client is intentionally dumb: no retries beyond httpx's
defaults, no caching. Failures bubble up to the tool handler, which formats
them for the agent to see and potentially recover from.

Auth model: shared-secret + trusted envelope. See
`src/app/api/agent/_lib/auth.ts` on the Next.js side.
"""

from __future__ import annotations

from typing import Any

import httpx

from workspace_operator.models import DraftNoteResult, SearchResult


class PoggleAPIError(RuntimeError):
    """Raised when the Poggle API returns a non-2xx response."""

    def __init__(self, status: int, error_code: str | None, message: str) -> None:
        super().__init__(f"Poggle API {status} ({error_code}): {message}")
        self.status = status
        self.error_code = error_code
        self.message = message


class PoggleClient:
    """Per-run HTTP client pinned to a single (user, workspace, branch) envelope."""

    def __init__(
        self,
        *,
        base_url: str,
        shared_secret: str,
        user_id: str,
        workspace_id: str,
        branch_id: str,
        run_id: str,
        timeout_s: float = 30.0,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._run_id = run_id
        self._headers = {
            "content-type": "application/json",
            "x-workspace-operator-secret": shared_secret,
            "x-workspace-operator-user-id": user_id,
            "x-workspace-operator-workspace-id": workspace_id,
            "x-workspace-operator-branch-id": branch_id,
            "x-workspace-operator-run-id": run_id,
        }
        self._owns_client = http_client is None
        self._client = http_client or httpx.AsyncClient(timeout=timeout_s)

    async def __aenter__(self) -> "PoggleClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def hybrid_search(self, query: str, limit: int = 10) -> list[SearchResult]:
        payload = await self._post("/api/agent/tools/search", {"query": query, "limit": limit})
        results = payload.get("results") or []
        return [SearchResult.model_validate(r) for r in results]

    async def draft_note(
        self,
        *,
        box_id: str,
        title: str,
        markdown_content: str,
        summary: str | None = None,
        tags: list[str] | None = None,
        folder_id: str | None = None,
    ) -> DraftNoteResult:
        payload = await self._post(
            "/api/agent/tools/draft_note",
            {
                "box_id": box_id,
                "title": title,
                "markdown_content": markdown_content,
                "summary": summary,
                "tags": tags or [],
                "folder_id": folder_id,
            },
        )
        return DraftNoteResult.model_validate(payload)

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        response = await self._client.post(url, headers=self._headers, json=body)
        if response.status_code >= 400:
            await self._raise_error(response)
        envelope = response.json()
        # Poggle returns `{ data: ..., meta: ... }` on success.
        data = envelope.get("data") if isinstance(envelope, dict) else None
        if data is None:
            raise PoggleAPIError(
                response.status_code,
                None,
                f"Poggle API returned unexpected envelope: {envelope}",
            )
        return data

    async def _raise_error(self, response: httpx.Response) -> None:
        error_code: str | None = None
        message = response.text
        try:
            body = response.json()
            if isinstance(body, dict):
                error_code = body.get("error_code")
                message = body.get("message", message)
        except Exception:  # noqa: BLE001 — we fall back to raw text
            pass
        raise PoggleAPIError(response.status_code, error_code, message)
