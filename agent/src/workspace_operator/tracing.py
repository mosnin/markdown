"""OpenAI Agents SDK tracing → Poggle activity feed.

This module installs a custom :class:`TracingProcessor` that batches span and
trace events emitted by the Agents SDK during a Workspace Operator run and
fire-and-forgets them to Poggle's `/api/agent/tools/trace` endpoint.

Design goals:

* **Best-effort.** A failure to POST trace events must NEVER abort the run.
  Every callback wraps its body in a broad ``try/except`` and logs at WARN.
* **Cheap.** Span callbacks are invoked synchronously by the Agents SDK
  inside the agent run loop. We do not await network calls there — instead
  we hand the event to a background ``asyncio.Task`` and return
  immediately.
* **Per-run scoped.** The processor is registered for the duration of one
  ``run_operator`` call via :func:`setup_tracing`; the returned handle's
  ``teardown()`` removes the processor (resetting the global processor list)
  so a long-lived worker doesn't accumulate registrations.

Event shape (matches the Next.js ``/api/agent/tools/trace`` route):

    {
      "run_id":     str,
      "span_id":    str,
      "parent_id":  str | None,
      "name":       str,
      "kind":       "trace_root" | "tool_call" | "llm_call"
                    | "guardrail" | "agent" | "handoff" | "span",
      "started_at": ISO8601 str | None,
      "ended_at":   ISO8601 str | None,
      "duration_ms": int | None,
      "metadata":   dict[str, Any],
    }
"""

from __future__ import annotations

import asyncio
import datetime
import logging
from dataclasses import dataclass
from typing import Any

from agents import add_trace_processor, set_trace_processors
from agents.tracing import Span, Trace, TracingProcessor

from workspace_operator.client import PoggleClient

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Span-data → "kind" classification
# ---------------------------------------------------------------------------

# Map the Agents SDK's `SpanData.type` strings onto a small set of kinds the
# activity feed cares about. Anything we don't recognize falls through to
# the generic "span" kind.
_SPAN_TYPE_TO_KIND: dict[str, str] = {
    "function": "tool_call",
    "generation": "llm_call",
    "response": "llm_call",
    "guardrail": "guardrail",
    "agent": "agent",
    "handoff": "handoff",
    "mcp_tools": "tool_call",
    "custom": "span",
    "task": "span",
    "turn": "span",
}


def _classify_span(span: Span[Any]) -> tuple[str, str]:
    """Return a ``(name, kind)`` pair for an Agents SDK span."""
    span_data = span.span_data
    span_type = getattr(span_data, "type", "span")
    kind = _SPAN_TYPE_TO_KIND.get(span_type, "span")
    name = getattr(span_data, "name", None) or span_type or "span"
    return name, kind


def _duration_ms(started_at: str | None, ended_at: str | None) -> int | None:
    if not started_at or not ended_at:
        return None
    try:
        # Agents SDK uses ISO 8601 with a trailing 'Z' for UTC.
        s = datetime.datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        e = datetime.datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
        return max(0, int((e - s).total_seconds() * 1000))
    except (ValueError, TypeError):
        return None


def _safe_export(obj: Any) -> dict[str, Any]:
    """Best-effort export of an SDK object to a JSON-friendly dict."""
    try:
        exported = obj.export()
        if isinstance(exported, dict):
            return exported
    except Exception:  # noqa: BLE001
        log.debug("tracing: export() failed for %r", obj, exc_info=True)
    return {}


# ---------------------------------------------------------------------------
# Processor
# ---------------------------------------------------------------------------


class PoggleTracingProcessor(TracingProcessor):
    """Forwards Agents-SDK trace/span events to Poggle's trace ingestion route.

    All POSTs are fire-and-forget: a synchronous SDK callback schedules an
    ``asyncio.create_task`` that awaits the HTTP call and swallows any
    exception. ``force_flush`` waits for any outstanding tasks so callers
    can ensure events have been transmitted before the run returns.
    """

    TRACE_PATH = "/api/agent/tools/trace"

    def __init__(self, client: PoggleClient, run_id: str) -> None:
        self._client = client
        self._run_id = run_id
        self._pending: set[asyncio.Task[Any]] = set()

    # ── TracingProcessor interface ────────────────────────────────────────

    def on_trace_start(self, trace: Trace) -> None:
        try:
            now = _now_iso()
            payload = {
                "run_id": self._run_id,
                "span_id": trace.trace_id,
                "parent_id": None,
                "name": trace.name,
                "kind": "trace_root",
                "started_at": now,
                "ended_at": None,
                "duration_ms": None,
                "metadata": {"event": "trace_start", **_safe_export(trace)},
            }
            self._enqueue(payload)
        except Exception:  # noqa: BLE001 — best-effort
            log.warning("tracing: on_trace_start failed", exc_info=True)

    def on_trace_end(self, trace: Trace) -> None:
        try:
            now = _now_iso()
            payload = {
                "run_id": self._run_id,
                "span_id": trace.trace_id,
                "parent_id": None,
                "name": trace.name,
                "kind": "trace_root",
                "started_at": None,
                "ended_at": now,
                "duration_ms": None,
                "metadata": {"event": "trace_end", **_safe_export(trace)},
            }
            self._enqueue(payload)
        except Exception:  # noqa: BLE001
            log.warning("tracing: on_trace_end failed", exc_info=True)

    def on_span_start(self, span: Span[Any]) -> None:
        # We emit a single event on span_end; starting events are noisy and
        # easily reconstructed from started_at on the end event.
        return None

    def on_span_end(self, span: Span[Any]) -> None:
        try:
            name, kind = _classify_span(span)
            payload = {
                "run_id": self._run_id,
                "span_id": span.span_id,
                "parent_id": span.parent_id,
                "name": name,
                "kind": kind,
                "started_at": span.started_at,
                "ended_at": span.ended_at,
                "duration_ms": _duration_ms(span.started_at, span.ended_at),
                "metadata": _safe_export(span),
            }
            self._enqueue(payload)
        except Exception:  # noqa: BLE001
            log.warning("tracing: on_span_end failed", exc_info=True)

    def shutdown(self) -> None:
        # Best-effort: cancel any in-flight POSTs. We do not block here
        # because the Modal worker may already be tearing down.
        for task in list(self._pending):
            if not task.done():
                task.cancel()
        self._pending.clear()

    def force_flush(self) -> None:
        """Wait for any outstanding POSTs to finish (or fail)."""
        if not self._pending:
            return
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            return
        if loop.is_closed():
            return

        pending = [t for t in self._pending if not t.done()]
        if not pending:
            return
        gathered = asyncio.gather(*pending, return_exceptions=True)
        if loop.is_running():
            # We're being called from inside the event loop; we can't
            # block. The caller can `await flush_tracing()` if they need
            # synchronous semantics.
            return
        try:
            loop.run_until_complete(gathered)
        except Exception:  # noqa: BLE001
            log.debug("tracing: force_flush gather raised", exc_info=True)

    # ── Internal: enqueue + post ──────────────────────────────────────────

    def _enqueue(self, payload: dict[str, Any]) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No running loop — drop the event. The Agents SDK invokes
            # processors from contexts that always have a loop, so this
            # is a defensive guard.
            log.debug("tracing: no running loop, dropping event")
            return
        task = loop.create_task(self._post(payload))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def _post(self, payload: dict[str, Any]) -> None:
        try:
            await self._client._client.post(  # noqa: SLF001 — intentional
                f"{self._client._base_url}{self.TRACE_PATH}",  # noqa: SLF001
                headers=self._client._headers,  # noqa: SLF001
                json=payload,
            )
        except Exception:  # noqa: BLE001 — fire-and-forget
            log.debug("tracing: trace POST failed for run %s", self._run_id, exc_info=True)


# ---------------------------------------------------------------------------
# Lifecycle helpers — called from operator.run_operator
# ---------------------------------------------------------------------------


@dataclass
class TracingHandle:
    """Returned by :func:`setup_tracing`. Call ``teardown()`` to deregister."""

    processor: PoggleTracingProcessor

    def teardown(self) -> None:
        try:
            self.processor.shutdown()
        finally:
            # Reset the processor list. The default OpenAI exporter is also
            # cleared; for an internal Modal worker that is the desired
            # behavior — we don't want OpenAI hosted tracing on by default.
            set_trace_processors([])


def setup_tracing(client: PoggleClient, run_id: str) -> TracingHandle:
    """Register a :class:`PoggleTracingProcessor` for the duration of a run.

    Replaces any pre-existing processors with our processor only.
    Use :func:`flush_tracing` (or call ``handle.processor.force_flush()``)
    before the run returns to ensure pending events are transmitted.
    """
    processor = PoggleTracingProcessor(client, run_id)
    # Replace, not append: we want a clean processor list per-run so events
    # never leak across runs in a long-lived worker.
    set_trace_processors([processor])
    log.debug("tracing: registered PoggleTracingProcessor for run %s", run_id)
    return TracingHandle(processor=processor)


def add_processor_for_run(client: PoggleClient, run_id: str) -> PoggleTracingProcessor:
    """Append a processor without clobbering existing ones (testing aid)."""
    processor = PoggleTracingProcessor(client, run_id)
    add_trace_processor(processor)
    return processor


async def flush_tracing(handle: TracingHandle) -> None:
    """Async-safe flush — awaits any in-flight trace POSTs, then tears down."""
    pending = [t for t in handle.processor._pending if not t.done()]  # noqa: SLF001
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    handle.teardown()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")
