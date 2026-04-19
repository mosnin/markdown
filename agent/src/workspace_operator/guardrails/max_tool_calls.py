"""Tool-call budget enforcement.

The OpenAI Agents SDK does not ship a "stop after N tool calls"
primitive — instead it exposes `max_turns` on `Runner.run`, which
limits the total number of model turns (each of which may issue zero
or more tool calls). For the Workspace Operator this is close enough:
the Operator is a tool-heavy loop where every turn either issues a
tool call or finalises the response. Bounding turns therefore bounds
tool calls within ~1x.

This module exposes:

  - `derive_max_turns(settings)`  — translates `Settings.max_tool_calls`
    into the integer passed to `Runner.run(..., max_turns=...)`.
  - `ToolCallBudgetExceeded`      — a domain exception we raise when a
    caller chooses to enforce the budget *inside* a tool wrapper rather
    than relying on `MaxTurnsExceeded` from the SDK.
  - `check_tool_call_budget(...)` — the in-tool check helper. Not used
    by the default Operator (we rely on `max_turns` for cheapness) but
    available for tools that want to fail fast before doing expensive
    I/O.

The tradeoff is documented at the call site in `operator.py`.
"""

from __future__ import annotations

from typing import Any

from workspace_operator.settings import Settings


class ToolCallBudgetExceeded(RuntimeError):
    """Raised when a tool would push the run past its tool-call budget."""

    def __init__(self, current: int, limit: int) -> None:
        super().__init__(
            f"tool call budget exceeded: {current} >= {limit}"
        )
        self.current = current
        self.limit = limit


def derive_max_turns(settings: Settings) -> int:
    """Map `Settings.max_tool_calls` → `Runner.run(max_turns=...)`.

    We use `max_tool_calls` directly. The SDK counts a "turn" as a
    single model invocation; tool-heavy runs trigger one tool call per
    turn, so the bound is tight in practice. We never return less than
    1 — a budget of 0 would prevent the agent from even thinking once.
    """
    return max(1, int(settings.max_tool_calls))


def check_tool_call_budget(ctx: Any, settings: Settings) -> None:
    """Raise `ToolCallBudgetExceeded` if the run has hit its budget.

    Expects `ctx` to expose a mutable `tool_calls` attribute (typically
    on `OperatorContext`). Increment-then-check is the caller's
    responsibility — this helper only reads.
    """
    current = int(getattr(ctx, "tool_calls", 0) or 0)
    limit = derive_max_turns(settings)
    if current >= limit:
        raise ToolCallBudgetExceeded(current, limit)
