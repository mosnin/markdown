"""FIFO override queue for human-approved tool-call args.

When a run is gated behind human approval (see approval_gate.py), the
reviewer may edit the tool's args before approving. The SDK invokes the
tool with the LLM's original args, so we enforce the edit at the client
layer: the gate pushes (tool_name, resolved_args) onto a per-run queue,
and each write-capable client method pops its matching entry before
invoking the backend.

The ordering guarantee relies on SDK semantics: on_tool_start runs
synchronously before tool execution, and asyncio tasks are single-threaded
within a run, so a FIFO correctly matches gate push with tool pop.
"""

from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass
from typing import Any

log = logging.getLogger(__name__)


@dataclass
class _PendingOverride:
    tool_name: str
    resolved_args: dict[str, Any]


class ApprovalOverrideQueue:
    """Thread-unsafe (asyncio-single-task) FIFO of pending arg overrides."""

    def __init__(self) -> None:
        self._queue: deque[_PendingOverride] = deque()

    def push(self, tool_name: str, resolved_args: dict[str, Any]) -> None:
        """Record an override to be consumed by the next matching tool call."""
        self._queue.append(
            _PendingOverride(tool_name=tool_name, resolved_args=resolved_args)
        )
        log.debug("approval_override pushed: tool=%s", tool_name)

    def consume(self, tool_name: str) -> dict[str, Any] | None:
        """Pop and return the front override if its tool_name matches.

        Returns None if the queue is empty or the front entry is for a
        different tool (defensive — shouldn't happen under correct usage).
        """
        if not self._queue:
            return None
        head = self._queue[0]
        if head.tool_name != tool_name:
            # Out-of-order. Don't consume; log and return None so the tool
            # runs with its original args rather than a mismatched override.
            log.warning(
                "approval_override front mismatch: front=%s, requested=%s",
                head.tool_name,
                tool_name,
            )
            return None
        popped = self._queue.popleft()
        log.debug("approval_override consumed: tool=%s", popped.tool_name)
        return popped.resolved_args

    def clear(self) -> None:
        self._queue.clear()
