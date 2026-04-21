"""HTTP client for calling back into the Poggle Next.js app.

Every tool the Workspace Operator exposes to the LLM resolves to one of
these methods. The client is intentionally dumb: no retries beyond httpx's
defaults, no caching. Failures bubble up to the tool handler, which formats
them for the agent to see and potentially recover from.

Auth model: shared-secret + trusted envelope. See
`src/app/api/agent/_lib/auth.ts` on the Next.js side.
"""

from __future__ import annotations

import datetime
import logging
from typing import Any

import httpx

from workspace_operator.models import DraftNoteResult, SearchResult

log = logging.getLogger(__name__)


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

    async def read_note(self, *, note_id: str) -> dict[str, Any]:
        """Fetch a note's branch-overlay view. Returns the raw envelope payload."""
        return await self._post(
            "/api/agent/tools/read_note",
            {"note_id": note_id},
        )

    async def edit_note(
        self,
        *,
        note_id: str,
        new_content: str,
        edit_summary: str | None = None,
    ) -> dict[str, Any]:
        """Write a new version of a note onto the run's branch."""
        return await self._post(
            "/api/agent/tools/edit_note",
            {
                "note_id": note_id,
                "new_content": new_content,
                "edit_summary": edit_summary,
            },
        )

    async def link_notes(
        self,
        *,
        source_note_id: str,
        target_note_id: str,
        relationship_type: str,
        relationship_note: str | None = None,
    ) -> dict[str, Any]:
        """Create a typed object_link between two notes on the run's branch."""
        return await self._post(
            "/api/agent/tools/link_notes",
            {
                "source_note_id": source_note_id,
                "target_note_id": target_note_id,
                "relationship_type": relationship_type,
                "relationship_note": relationship_note,
            },
        )

    async def list_notes_in_box(
        self,
        *,
        box_id: str,
        include_archived: bool = False,
        limit: int = 50,
    ) -> dict[str, Any]:
        """List notes in a box so the agent can orient before drafting/editing."""
        return await self._post(
            "/api/agent/tools/list_notes_in_box",
            {
                "box_id": box_id,
                "include_archived": include_archived,
                "limit": limit,
            },
        )

    async def archive_note(self, *, note_id: str) -> dict[str, Any]:
        """Archive a note (reversible). Guide notes cannot be archived."""
        return await self._post(
            "/api/agent/tools/archive_note",
            {"note_id": note_id},
        )

    async def rename_note(self, *, note_id: str, new_title: str) -> dict[str, Any]:
        """Rename a note on the run's branch — lands as a branch-scoped version."""
        return await self._post(
            "/api/agent/tools/rename_note",
            {"note_id": note_id, "new_title": new_title},
        )

    async def move_note(
        self, *, note_id: str, folder_id: str | None
    ) -> dict[str, Any]:
        """Move a note to a different folder within the same box."""
        return await self._post(
            "/api/agent/tools/move_note",
            {"note_id": note_id, "folder_id": folder_id},
        )

    async def apply_template(
        self,
        *,
        template_id: str,
        title: str,
        variables: dict[str, str] | None = None,
        box_id: str,
    ) -> dict[str, Any]:
        """Instantiate a template into a new note on the run's branch."""
        return await self._post(
            "/api/agent/tools/apply_template",
            {
                "template_id": template_id,
                "title": title,
                "variables": variables or {},
                "box_id": box_id,
            },
        )

    async def web_fetch(self, *, url: str) -> dict[str, Any]:
        """Fetch a public URL via the trusted Next.js proxy (SSRF-guarded)."""
        return await self._post(
            "/api/agent/tools/web_fetch",
            {"url": url},
        )

    async def web_search(
        self,
        *,
        query: str,
        max_results: int = 5,
        include_answer: bool = True,
    ) -> dict[str, Any]:
        """Search the public web via Tavily (keyed on the Next.js server)."""
        return await self._post(
            "/api/agent/tools/web_search",
            {
                "query": query,
                "max_results": max_results,
                "include_answer": include_answer,
            },
        )

    async def fetch_workspace_context(
        self, *, box_id: str | None = None
    ) -> dict[str, Any]:
        """Fetch deterministic workspace metadata for prompt-cache prefixes.

        Returns `{
            workspace_name,
            workspace_instructions,   # user-set rules for every Pog run in this workspace
            box_instructions,          # user-set rules scoped to `box_id` (if provided)
            boxes: [{id, name, note_count}, ...]
        }` with boxes sorted deterministically server-side so the same
        workspace always renders to the same bytes. Used by
        `operator._build_workspace_context_block` when it wants richer
        context than the bare envelope.
        """
        payload: dict[str, Any] = {}
        if box_id:
            payload["box_id"] = box_id
        return await self._post("/api/agent/tools/workspace_context", payload)

    async def fetch_run_memory(self, *, limit: int = 5) -> dict[str, Any]:
        """Fetch compact summaries of this user's recent completed runs.

        Used to build a "Run memory" prologue prepended to the user's
        current prompt so the agent can stop re-solving the same
        discovery problem every run. Kept tiny (≤10 runs × short
        preview) so it doesn't bloat the per-run prompt.
        """
        return await self._post(
            "/api/agent/tools/run_memory",
            {"limit": limit},
        )

    async def check_cancellation(self, run_id: str) -> bool:
        """Ask the Next.js side whether this run has been cancelled.

        Polled by the operator between phases (and periodically inside long
        execute runs). Returns True iff `workspace_operator_runs.cancellation_requested_at`
        is non-NULL for this run id. Network failures are *not* swallowed —
        the operator catches them and treats them as "keep going" so a
        transient blip doesn't fake-cancel a healthy run, but unexpected
        errors still propagate up for observability.

        We use GET because the lookup is read-only / idempotent.
        """
        url = f"{self._base_url}/api/agent/operator/check_cancel"
        response = await self._client.get(
            url,
            headers=self._headers,
            params={"run_id": run_id},
        )
        if response.status_code >= 400:
            await self._raise_error(response)
        envelope = response.json()
        data = envelope.get("data") if isinstance(envelope, dict) else None
        if not isinstance(data, dict):
            raise PoggleAPIError(
                response.status_code,
                None,
                f"check_cancel returned unexpected envelope: {envelope}",
            )
        return bool(data.get("cancelled", False))

    async def request_approval(
        self,
        *,
        tool_call_id: str,
        tool_name: str,
        requested_args: dict[str, Any],
        preview: dict[str, Any] | None = None,
        timeout_seconds: int | None = None,
    ) -> dict[str, Any]:
        """Request human approval for a tool call. Returns { approval_id }."""
        return await self._post(
            "/api/agent/operator/approval/request",
            {
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "requested_args": requested_args,
                "preview": preview,
                "timeout_seconds": timeout_seconds,
            },
        )

    async def poll_approval(self, tool_call_id: str) -> dict[str, Any]:
        """Poll approval status. Returns { status, resolved_args?, reject_reason? }."""
        return await self._post(
            "/api/agent/operator/approval/poll",
            {"tool_call_id": tool_call_id},
        )

    async def poll_steer_messages(self) -> dict[str, Any]:
        """Fetch + consume unread steering messages for this run."""
        return await self._post(
            "/api/agent/operator/steer/poll",
            {},
        )

    async def read_memories(
        self,
        *,
        memory_type: str | None = None,
        limit: int = 10,
    ) -> dict[str, Any]:
        """Read agent memories for the workspace."""
        return await self._post(
            "/api/agent/tools/memories",
            {"operation": "read", "memory_type": memory_type, "limit": limit},
        )

    async def write_memory(
        self,
        *,
        memory_type: str,
        title: str,
        content: str,
        relevance: float = 1.0,
    ) -> dict[str, Any]:
        """Persist a memory for future runs to consume."""
        return await self._post(
            "/api/agent/tools/memories",
            {
                "operation": "write",
                "memory_type": memory_type,
                "title": title,
                "content": content,
                "relevance": relevance,
            },
        )

    async def boost_memory(self, *, memory_id: str) -> dict[str, Any]:
        """Mark a memory as recently used (touch last_used_at)."""
        return await self._post(
            "/api/agent/tools/memories",
            {"operation": "boost", "memory_id": memory_id},
        )

    async def execute_code(
        self,
        *,
        language: str,
        code: str,
        timeout_seconds: int = 15,
    ) -> dict[str, Any]:
        """Execute code in a sandboxed environment."""
        return await self._post(
            "/api/agent/tools/execute_code",
            {"language": language, "code": code, "timeout_seconds": timeout_seconds},
        )

    async def propose_box_structure(
        self,
        *,
        workspace_scope: str = "all",
        box_id: str | None = None,
    ) -> dict[str, Any]:
        """Request an AI-generated proposed reorganization of boxes."""
        return await self._post(
            "/api/agent/tools/propose_box_structure",
            {"workspace_scope": workspace_scope, "box_id": box_id},
        )

    async def report_progress(
        self,
        *,
        event_type: str,  # "step_start" | "step_complete" | "tool_call" | "note_drafted" | "completed" | "failed"
        step_index: int | None = None,
        detail: str | None = None,
    ) -> None:
        """Fire-and-forget progress callback to Next.js. Failures are logged but not raised."""
        try:
            await self._client.post(
                f"{self._base_url}/api/agent/tools/progress",
                headers=self._headers,
                json={
                    "run_id": self._run_id,
                    "type": event_type,
                    "step_index": step_index,
                    "detail": detail,
                    "timestamp": datetime.datetime.now(datetime.UTC).isoformat(),
                },
            )
        except Exception:  # noqa: BLE001
            log.warning("progress callback failed for run %s", self._run_id, exc_info=True)

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
