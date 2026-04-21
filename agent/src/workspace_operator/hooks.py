"""Streaming RunHooks for the Workspace Operator.

This module defines :class:`StreamingOperatorHooks`, a subclass of the
OpenAI Agents SDK's :class:`agents.RunHooks` that forwards every lifecycle
event (agent start/end, LLM start/end, tool start/end, handoff) to the
Poggle Next.js app's ``/api/agent/operator/tool_call_event`` endpoint.

Design notes
============

*   **Fire-and-forget.** SDK hook callbacks run inline inside the agent
    loop. Blocking on a network round-trip would stall every turn, so
    event POSTs are scheduled via :func:`asyncio.create_task` and their
    errors are swallowed with a WARN log. A network hiccup in the
    streaming channel must never abort a run.

*   **Inline sync work.** Token-delta bookkeeping and the per-run budget
    check must run *before* the callback returns, because the SDK checks
    the raised exception to unwind the run cleanly. Only the POST is
    deferred to a task.

*   **Self-contained budget check.** The existing ``_BudgetHooks`` class
    in :mod:`workspace_operator.operator` is private; rather than reach
    across a leading-underscore boundary, we copy its compact ``_check``
    logic here and delegate to :class:`OperatorBudgetExceeded` for the
    actual exception type (which IS public).

*   **Tool-approval gate hook point.** ``on_tool_start`` accepts an
    optional ``on_tool_gate`` callable. This is the seam where a future
    human-in-the-loop approval flow can block the tool call or mutate
    its arguments. The asyncio.Event approval machinery lives elsewhere
    — here we only define the seam and propagate :class:`ToolCallRejected`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Awaitable, Callable

from agents import RunHooks

from workspace_operator.approval_gate import ToolCallRejected
from workspace_operator.client import PoggleClient
from workspace_operator.operator import OperatorBudgetExceeded

log = logging.getLogger(__name__)


__all__ = ["StreamingOperatorHooks", "ToolCallRejected"]


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


# A gate callback may be sync or async. It receives (tool_name, tool_call_id, args)
# and must return the resolved args dict (possibly edited) or raise
# ToolCallRejected.
ToolGate = Callable[
    [str, str, dict[str, Any]],
    "dict[str, Any] | Awaitable[dict[str, Any]]",
]


# Event endpoint on the Next.js side. Matches the Poggle trusted-envelope
# auth scheme; see `src/app/api/agent/operator/tool_call_event/route.ts`.
_EVENT_PATH = "/api/agent/operator/tool_call_event"


# Maximum characters we include in a ``tool_call_end`` ``output_preview``.
# Keep this small: the full tool result is already persisted server-side
# by the tool handler; the preview is for activity-feed chrome only.
_OUTPUT_PREVIEW_MAX_CHARS = 2000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _coerce_args(raw: Any) -> dict[str, Any]:
    """Best-effort coercion of a tool's arguments to a JSON dict.

    The SDK exposes tool arguments variably — sometimes as a dict, some-
    times as a JSON string (raw model output), sometimes as a Pydantic
    model, sometimes not at all. We never raise; unparseable blobs come
    back as ``{"raw": <str>}`` so the UI still has *something* to show.
    """
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return {}
        try:
            parsed = json.loads(s)
        except (ValueError, TypeError):
            return {"raw": raw}
        if isinstance(parsed, dict):
            return parsed
        return {"value": parsed}
    # Pydantic or similar
    for attr in ("model_dump", "dict"):
        fn = getattr(raw, attr, None)
        if callable(fn):
            try:
                out = fn()
            except Exception:  # noqa: BLE001
                continue
            if isinstance(out, dict):
                return out
    return {"repr": repr(raw)}


def _extract_tool_name(tool: Any) -> str:
    """Pull a display name off a tool object, tolerating SDK shape drift."""
    for attr in ("name", "tool_name", "function_name"):
        val = getattr(tool, attr, None)
        if isinstance(val, str) and val:
            return val
    # Nested ``tool.function.name`` shape used by some SDK versions.
    function = getattr(tool, "function", None)
    if function is not None:
        val = getattr(function, "name", None)
        if isinstance(val, str) and val:
            return val
    return "<unknown_tool>"


def _extract_tool_call_id(tool: Any) -> str:
    """Pull a stable call id off a tool object.

    The field has moved around across SDK versions: ``call_id`` on newer
    builds, ``id`` on older ones, ``tool_call_id`` in some tool-result
    contexts. Fall back to the object's ``id()`` so the UI at least has a
    unique handle within the run.
    """
    for attr in ("call_id", "tool_call_id", "id"):
        val = getattr(tool, attr, None)
        if isinstance(val, str) and val:
            return val
    return f"call-{id(tool):x}"


def _extract_tool_args(tool: Any) -> dict[str, Any]:
    """Extract arguments from a tool invocation object."""
    for attr in ("arguments", "args", "input", "parameters"):
        val = getattr(tool, attr, None)
        if val is not None:
            return _coerce_args(val)
    return {}


def _extract_usage(response: Any) -> tuple[int, int]:
    """Return ``(input_tokens, output_tokens)`` from a model response.

    The Agents SDK surfaces usage on the response object, but older
    versions use ``prompt_tokens``/``completion_tokens`` instead. Be
    liberal in what we accept.
    """
    usage = getattr(response, "usage", None)
    if usage is None:
        return 0, 0
    input_tokens = (
        getattr(usage, "input_tokens", None)
        or getattr(usage, "prompt_tokens", None)
        or 0
    )
    output_tokens = (
        getattr(usage, "output_tokens", None)
        or getattr(usage, "completion_tokens", None)
        or 0
    )
    try:
        return int(input_tokens or 0), int(output_tokens or 0)
    except (TypeError, ValueError):
        return 0, 0


def _extract_context_usage(ctx_wrapper: Any) -> tuple[int, int]:
    """Mirror of ``_BudgetHooks._check`` usage extraction."""
    usage = getattr(ctx_wrapper, "usage", None)
    if usage is None:
        return 0, 0
    try:
        used_in = int(getattr(usage, "input_tokens", 0) or 0)
        used_out = int(getattr(usage, "output_tokens", 0) or 0)
    except (TypeError, ValueError):
        return 0, 0
    return used_in, used_out


def _resolve_model_hint(agent: Any) -> str | None:
    """Best-effort extraction of the model id configured on an agent."""
    for attr in ("model", "model_name"):
        val = getattr(agent, attr, None)
        if isinstance(val, str) and val:
            return val
    # Some SDK versions store a ModelSettings object on the agent.
    settings = getattr(agent, "model_settings", None)
    if settings is not None:
        val = getattr(settings, "model", None)
        if isinstance(val, str) and val:
            return val
    return None


# ---------------------------------------------------------------------------
# StreamingOperatorHooks
# ---------------------------------------------------------------------------


class StreamingOperatorHooks(RunHooks):
    """RunHooks subclass that streams every lifecycle event to Next.js.

    Fires fire-and-forget POSTs to ``/api/agent/operator/tool_call_event``
    on every agent/LLM/tool/handoff lifecycle event. Also honours the
    per-run token budget (duplicating the compact logic from
    :class:`workspace_operator.operator._BudgetHooks`) so a single hook
    object covers both features.

    Events are fired via ``asyncio.create_task`` so the SDK callback
    returns immediately; the poster catches and logs any network errors
    — a stream hiccup never aborts a run.
    """

    def __init__(
        self,
        client: PoggleClient,
        run_id: str,
        *,
        max_input_tokens: int | None = None,
        max_output_tokens: int | None = None,
        on_tool_gate: ToolGate | None = None,
    ) -> None:
        self._client = client
        self._run_id = run_id
        self._max_in = max_input_tokens
        self._max_out = max_output_tokens
        self._on_tool_gate = on_tool_gate

        # State ----------------------------------------------------------------
        # Guard flag so we only fire ``run_start`` once even if the SDK
        # invokes ``on_agent_start`` for sub-agents during handoffs.
        self._run_started = False

        # Monotonic timestamp of the most recent ``on_llm_start``; consumed
        # by ``on_llm_end`` to compute elapsed_ms.
        self._llm_started_at: float | None = None

        # Per-tool-call start times for elapsed_ms computation. Keyed by
        # tool_call_id so concurrent tool invocations don't clobber one
        # another (the SDK may issue parallel tool calls in a single turn).
        self._tool_started_at: dict[str, float] = {}

        # Last-seen usage totals — used to compute token deltas per LLM
        # call. We store totals (not deltas) because the SDK reports
        # *cumulative* usage on the context wrapper.
        self._last_input_tokens = 0
        self._last_output_tokens = 0

        # Pending task bag so we can best-effort drain on shutdown. Not
        # strictly required (orphaned tasks would still run on the loop)
        # but keeps asyncio from warning about never-awaited coroutines
        # if the loop tears down mid-flight.
        self._pending: set[asyncio.Task[Any]] = set()

    # ------------------------------------------------------------------
    # Internal: event emission
    # ------------------------------------------------------------------

    def _fire(self, coro: Awaitable[None]) -> None:
        """Schedule a coroutine as a background task, tracking it."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No running loop — the SDK always invokes hooks from within
            # one, so this is a defensive guard. Drop the event rather
            # than raise (a stream hiccup must never abort a run).
            log.debug("[hooks] no running loop, dropping event")
            # Close the coroutine to silence the "never awaited" warning.
            close = getattr(coro, "close", None)
            if callable(close):
                close()
            return
        task = loop.create_task(coro)
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def _emit(
        self,
        event_type: str,
        *,
        tool_call_id: str | None = None,
        tool_name: str | None = None,
        step_index: int | None = None,
        elapsed_ms: int | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        """POST one lifecycle event to Next.js. Never raises."""
        try:
            body = {
                "event_type": event_type,
                "run_id": self._run_id,
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "step_index": step_index,
                "elapsed_ms": elapsed_ms,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "payload": payload or {},
            }
            # Reach into the PoggleClient internals: events are too
            # polymorphic to justify a dedicated typed method on the
            # client, and we want to share the auth headers + base URL
            # without reimplementing the envelope.
            await self._client._client.post(  # noqa: SLF001 — intentional
                f"{self._client._base_url}{_EVENT_PATH}",  # noqa: SLF001
                headers=self._client._headers,  # noqa: SLF001
                json=body,
            )
        except Exception:  # noqa: BLE001 — fire-and-forget
            log.warning("[hooks] event post failed: %s", event_type, exc_info=True)

    # ------------------------------------------------------------------
    # Internal: budget check (copied from _BudgetHooks)
    # ------------------------------------------------------------------

    def _check_budget(self, ctx_wrapper: Any) -> None:
        """Raise :class:`OperatorBudgetExceeded` if usage has blown past caps.

        Mirrors :meth:`workspace_operator.operator._BudgetHooks._check`.
        Copied rather than imported because the original class is private.
        """
        if self._max_in is None and self._max_out is None:
            return
        used_in, used_out = _extract_context_usage(ctx_wrapper)
        if used_in == 0 and used_out == 0:
            return
        if self._max_in is not None and used_in > self._max_in:
            raise OperatorBudgetExceeded(used_in, used_out, self._max_in, self._max_out)
        if self._max_out is not None and used_out > self._max_out:
            raise OperatorBudgetExceeded(used_in, used_out, self._max_in, self._max_out)

    # ------------------------------------------------------------------
    # Lifecycle hooks
    # ------------------------------------------------------------------
    #
    # Signatures follow the openai-agents SDK as used elsewhere in this
    # package (see operator._BudgetHooks for precedent). We accept
    # ``*args, **kwargs`` on each hook so minor version drift in the SDK
    # (extra positional args, renamed kwargs) doesn't break the run.

    async def on_agent_start(self, context, agent, *args, **kwargs) -> None:  # type: ignore[override,no-untyped-def]
        if self._run_started:
            # A handoff will re-invoke on_agent_start for the sub-agent.
            # That gets reported via on_handoff / subagent_start — we only
            # fire one ``run_start`` per run, representing the top-level
            # agent.
            self._fire(
                self._emit(
                    "subagent_start",
                    payload={
                        "agent_name": getattr(agent, "name", None),
                        "model_hint": _resolve_model_hint(agent),
                    },
                )
            )
            return
        self._run_started = True
        self._fire(
            self._emit(
                "run_start",
                payload={
                    "agent_name": getattr(agent, "name", None),
                    "model_hint": _resolve_model_hint(agent),
                },
            )
        )

    async def on_agent_end(self, context, agent, output, *args, **kwargs) -> None:  # type: ignore[override,no-untyped-def]
        self._fire(
            self._emit(
                "subagent_end",
                payload={"agent_name": getattr(agent, "name", None)},
            )
        )

    async def on_llm_start(
        self,
        context,  # type: ignore[no-untyped-def]
        agent,
        system_prompt=None,
        input_items=None,
        *args,
        **kwargs,
    ) -> None:  # type: ignore[override]
        self._llm_started_at = time.monotonic()
        self._fire(
            self._emit(
                "llm_call_start",
                payload={"agent_name": getattr(agent, "name", None)},
            )
        )

    async def on_llm_end(self, context, agent, response, *args, **kwargs) -> None:  # type: ignore[override,no-untyped-def]
        # Elapsed time for this LLM call, if we saw a matching start.
        elapsed_ms: int | None = None
        if self._llm_started_at is not None:
            elapsed_ms = max(0, int((time.monotonic() - self._llm_started_at) * 1000))
            self._llm_started_at = None

        # Token-delta bookkeeping. We read cumulative totals off the
        # context wrapper (that's where the SDK maintains them across
        # the run) and fall back to the response if the wrapper is empty.
        ctx_in, ctx_out = _extract_context_usage(context)
        if ctx_in == 0 and ctx_out == 0:
            ctx_in, ctx_out = _extract_usage(response)

        delta_in = max(0, ctx_in - self._last_input_tokens)
        delta_out = max(0, ctx_out - self._last_output_tokens)
        self._last_input_tokens = ctx_in
        self._last_output_tokens = ctx_out

        # Emit llm_call_end + usage_update. Both go out as separate
        # events so consumers can subscribe to usage without decoding the
        # full llm_call_end payload.
        self._fire(
            self._emit(
                "llm_call_end",
                elapsed_ms=elapsed_ms,
                input_tokens=ctx_in,
                output_tokens=ctx_out,
                payload={"agent_name": getattr(agent, "name", None)},
            )
        )
        self._fire(
            self._emit(
                "usage_update",
                input_tokens=ctx_in,
                output_tokens=ctx_out,
                payload={
                    "input_tokens_total": ctx_in,
                    "output_tokens_total": ctx_out,
                    "input_tokens_delta": delta_in,
                    "output_tokens_delta": delta_out,
                },
            )
        )

        # Budget check is SYNC and inline — if we're over, we must raise
        # before returning so the SDK unwinds the run.
        self._check_budget(context)

    async def on_tool_start(self, context, agent, tool, *args, **kwargs) -> None:  # type: ignore[override,no-untyped-def]
        tool_name = _extract_tool_name(tool)
        tool_call_id = _extract_tool_call_id(tool)
        resolved_args = _extract_tool_args(tool)

        # Record start time BEFORE the gate runs: if the gate blocks for
        # human approval, we still want elapsed_ms to include that wait.
        self._tool_started_at[tool_call_id] = time.monotonic()

        # Approval-gate seam. Run inline — this is the whole point of
        # the gate, and the SDK catches ToolCallRejected from the hook.
        if self._on_tool_gate is not None:
            try:
                gate_result = self._on_tool_gate(tool_name, tool_call_id, resolved_args)
                if asyncio.iscoroutine(gate_result) or asyncio.isfuture(gate_result):
                    gate_result = await gate_result  # type: ignore[assignment]
                if isinstance(gate_result, dict):
                    resolved_args = gate_result
            except ToolCallRejected:
                # Surface the rejection to the UI before propagating.
                self._fire(
                    self._emit(
                        "tool_call_end",
                        tool_call_id=tool_call_id,
                        tool_name=tool_name,
                        payload={
                            "tool_name": tool_name,
                            "tool_call_id": tool_call_id,
                            "rejected": True,
                        },
                    )
                )
                self._tool_started_at.pop(tool_call_id, None)
                raise

        self._fire(
            self._emit(
                "tool_call_start",
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                payload={
                    "tool_name": tool_name,
                    "tool_call_id": tool_call_id,
                    "args": resolved_args,
                },
            )
        )

    async def on_tool_end(self, context, agent, tool, result, *args, **kwargs) -> None:  # type: ignore[override,no-untyped-def]
        tool_name = _extract_tool_name(tool)
        tool_call_id = _extract_tool_call_id(tool)

        started = self._tool_started_at.pop(tool_call_id, None)
        elapsed_ms: int | None = None
        if started is not None:
            elapsed_ms = max(0, int((time.monotonic() - started) * 1000))

        # Bounded preview — the full result is persisted server-side by
        # the tool handler itself; this is for the activity-feed chrome.
        try:
            preview_source = str(result)
        except Exception:  # noqa: BLE001
            preview_source = repr(result)
        output_preview = preview_source[:_OUTPUT_PREVIEW_MAX_CHARS]

        self._fire(
            self._emit(
                "tool_call_end",
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                elapsed_ms=elapsed_ms,
                payload={
                    "tool_name": tool_name,
                    "tool_call_id": tool_call_id,
                    "elapsed_ms": elapsed_ms,
                    "output_preview": output_preview,
                },
            )
        )

        # Cheap defence-in-depth budget check on tool end, matching the
        # pattern in _BudgetHooks.
        self._check_budget(context)

    async def on_handoff(self, context, from_agent, to_agent, *args, **kwargs) -> None:  # type: ignore[override,no-untyped-def]
        self._fire(
            self._emit(
                "subagent_start",
                payload={
                    "from": getattr(from_agent, "name", None),
                    "to": getattr(to_agent, "name", None),
                },
            )
        )
