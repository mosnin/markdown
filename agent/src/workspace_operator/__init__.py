"""Poggle Workspace Operator — a Modal-deployed OpenAI Agents SDK agent.

The Operator is invoked from the Next.js app via `dispatchOperatorRun` in
`src/server/services/workspace_operator_service.ts`. It receives a
`(user_id, workspace_id, branch_id, box_id, prompt)` envelope, runs an
agentic loop with a fixed toolbelt, and produces one or more draft notes
on the caller-supplied branch — which the user then reviews as a diff.
"""

from workspace_operator.approval_gate import (
    REQUIRES_APPROVAL_TOOLS,
    ToolCallApproved,
    ToolCallRejected,
    ToolCallTimedOut,
    await_approval,
    should_gate_tool,
)
from workspace_operator.models import OperatorInput, OperatorResult
from workspace_operator.steering import (
    SteerMessage,
    fetch_steer_messages,
    format_steer_injection,
    run_steer_poller,
)

__all__ = [
    "OperatorInput",
    "OperatorResult",
    "ToolCallApproved",
    "ToolCallRejected",
    "ToolCallTimedOut",
    "await_approval",
    "should_gate_tool",
    "REQUIRES_APPROVAL_TOOLS",
    "SteerMessage",
    "fetch_steer_messages",
    "format_steer_injection",
    "run_steer_poller",
]
