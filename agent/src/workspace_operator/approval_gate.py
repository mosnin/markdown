"""Human-in-the-loop approval gate for tool calls.

When a run is configured with ``requires_approval`` or uses a persona that
requires approval for a specific tool, every call to that tool pauses in the
operator's on_tool_start hook until a human approves (possibly with edited
args) or rejects via the Next.js UI.

Architecture:
  * Agent calls ``request_approval`` -> POSTs /api/agent/operator/approval/request
  * Agent polls ``poll_approval`` until status != pending
  * On "approved": returns resolved_args (possibly edited); caller uses these
    instead of the model-proposed args when invoking the tool
  * On "rejected": raises ToolCallRejected with the reject_reason; caller
    catches and reports back to the LLM as a tool error

The approval gate uses polling (not a websocket) because the tool-call
boundary is already HTTP-based and we want to keep the agent loop simple.
Poll interval starts at 500ms and backs off to 2s after the first few polls.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from workspace_operator.client import PoggleClient

log = logging.getLogger(__name__)


# Tools that require human approval when the run or persona demands it.
REQUIRES_APPROVAL_TOOLS: frozenset[str] = frozenset(
    {
        "draft_note",
        "edit_note",
        "archive_note",
        "link_notes",
        "apply_template",
        "execute_code",
    }
)


_INITIAL_POLL_INTERVAL_S: float = 0.5
_MAX_POLL_INTERVAL_S: float = 2.0
_BACKOFF_AFTER_POLLS: int = 3


@dataclass
class ToolCallApproved:
    """Result of a successful approval, carrying the (possibly edited) args."""

    resolved_args: dict[str, Any]


class ToolCallRejected(Exception):
    """Raised when the human operator rejects a tool call."""

    def __init__(self, reject_reason: str) -> None:
        super().__init__(f"tool call rejected: {reject_reason}")
        self.reject_reason = reject_reason


class ToolCallTimedOut(Exception):
    """Raised when the approval times out without a human decision."""


def should_gate_tool(
    tool_name: str,
    *,
    run_requires_approval: bool,
    persona_requires_approval: bool,
) -> bool:
    """Return True iff this tool call must be gated behind human approval."""
    if tool_name not in REQUIRES_APPROVAL_TOOLS:
        return False
    return run_requires_approval or persona_requires_approval


async def await_approval(
    client: "PoggleClient",
    *,
    tool_call_id: str,
    tool_name: str,
    requested_args: dict[str, Any],
    preview: dict[str, Any] | None = None,
    timeout_s: float = 300.0,
) -> ToolCallApproved:
    """Block until a human decides on this tool call (or timeout).

    Posts the approval request, then polls with a short-then-backoff cadence.
    Returns a ``ToolCallApproved`` carrying resolved_args (which may have been
    edited by the reviewer). Raises ``ToolCallRejected`` or
    ``ToolCallTimedOut`` otherwise.
    """
    await client.request_approval(
        tool_call_id=tool_call_id,
        tool_name=tool_name,
        requested_args=requested_args,
        preview=preview,
        timeout_seconds=int(timeout_s),
    )

    deadline = time.monotonic() + timeout_s
    interval = _INITIAL_POLL_INTERVAL_S
    poll_count = 0

    while True:
        await asyncio.sleep(interval)
        poll_count += 1
        if poll_count > _BACKOFF_AFTER_POLLS:
            interval = min(interval * 2.0, _MAX_POLL_INTERVAL_S)

        if time.monotonic() > deadline:
            log.info(
                "approval timed out for tool_call_id=%s tool=%s",
                tool_call_id,
                tool_name,
            )
            raise ToolCallTimedOut()

        try:
            result = await client.poll_approval(tool_call_id)
        except Exception:  # noqa: BLE001 — transient blip, keep polling
            log.warning(
                "poll_approval failed for tool_call_id=%s",
                tool_call_id,
                exc_info=True,
            )
            continue

        status = result.get("status") if isinstance(result, dict) else None

        if status == "approved":
            resolved = (
                result.get("resolved_args")
                if isinstance(result, dict)
                else None
            )
            return ToolCallApproved(
                resolved_args=resolved if isinstance(resolved, dict) else requested_args
            )

        if status == "rejected":
            reason = (
                result.get("reject_reason")
                if isinstance(result, dict)
                else None
            )
            raise ToolCallRejected(reject_reason=reason or "user rejected")

        if status == "timed_out":
            raise ToolCallTimedOut()

        # "pending" or unknown -> keep polling.
