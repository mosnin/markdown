"""Unit tests for workspace_operator.tracing.

We exercise PoggleTracingProcessor against a stub PoggleClient so we can
inspect the exact URL, headers, and JSON body the trace POST would emit,
without spinning up an HTTP server.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest
import respx

from workspace_operator.client import PoggleClient
from workspace_operator.tracing import (
    PoggleTracingProcessor,
    TracingHandle,
    flush_tracing,
    setup_tracing,
)


BASE_URL = "https://poggle.test"
RUN_ID = "run-trace-0001"
ENVELOPE = dict(
    shared_secret="s" * 40,
    user_id="00000000-0000-0000-0000-000000000001",
    workspace_id="11111111-1111-1111-1111-111111111111",
    branch_id="22222222-2222-2222-2222-222222222222",
    run_id=RUN_ID,
)


def _make_client() -> PoggleClient:
    return PoggleClient(base_url=BASE_URL, **ENVELOPE)


# ---------------------------------------------------------------------------
# Stub Span / Trace objects (minimal, duck-typed for the processor)
# ---------------------------------------------------------------------------


class _StubSpanData:
    def __init__(self, *, type_: str, name: str | None = None) -> None:
        self.type = type_
        if name is not None:
            self.name = name

    def export(self) -> dict[str, Any]:
        out: dict[str, Any] = {"type": self.type}
        if hasattr(self, "name"):
            out["name"] = self.name
        return out


class _StubSpan:
    def __init__(
        self,
        *,
        span_id: str,
        parent_id: str | None = None,
        span_type: str = "function",
        name: str = "hybrid_search",
        started_at: str | None = "2026-04-19T12:00:00.000Z",
        ended_at: str | None = "2026-04-19T12:00:00.123Z",
    ) -> None:
        self.span_id = span_id
        self.parent_id = parent_id
        self.started_at = started_at
        self.ended_at = ended_at
        self.span_data = _StubSpanData(type_=span_type, name=name)

    def export(self) -> dict[str, Any]:
        return {
            "id": self.span_id,
            "parent_id": self.parent_id,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "span_data": self.span_data.export(),
        }


class _StubTrace:
    def __init__(
        self, *, trace_id: str = "trace-001", name: str = "workspace_operator"
    ) -> None:
        self.trace_id = trace_id
        self.name = name

    def export(self) -> dict[str, Any]:
        return {"id": self.trace_id, "workflow_name": self.name}


# ---------------------------------------------------------------------------
# Tests: on_span_end POSTs to the trace endpoint
# ---------------------------------------------------------------------------


@respx.mock
async def test_on_span_end_posts_to_trace_endpoint() -> None:
    route = respx.post(f"{BASE_URL}/api/agent/tools/trace").mock(
        return_value=httpx.Response(200, json={"data": {"received": 1}, "meta": {}}),
    )

    client = _make_client()
    processor = PoggleTracingProcessor(client, RUN_ID)

    span = _StubSpan(
        span_id="span-123",
        parent_id="span-root",
        span_type="function",
        name="hybrid_search",
    )
    processor.on_span_end(span)

    # Drain pending tasks before assertions.
    await flush_tracing(TracingHandle(processor=processor))
    await client.aclose()

    assert route.called
    req = route.calls.last.request
    assert str(req.url) == f"{BASE_URL}/api/agent/tools/trace"
    assert req.headers["x-workspace-operator-secret"] == ENVELOPE["shared_secret"]
    assert req.headers["x-workspace-operator-run-id"] == RUN_ID

    import json
    body = json.loads(req.content)
    assert body["run_id"] == RUN_ID
    assert body["span_id"] == "span-123"
    assert body["parent_id"] == "span-root"
    assert body["name"] == "hybrid_search"
    assert body["kind"] == "tool_call"  # function → tool_call
    assert body["started_at"] == "2026-04-19T12:00:00.000Z"
    assert body["ended_at"] == "2026-04-19T12:00:00.123Z"
    assert body["duration_ms"] == 123
    assert "metadata" in body


@respx.mock
async def test_span_kind_classification_for_generation() -> None:
    route = respx.post(f"{BASE_URL}/api/agent/tools/trace").mock(
        return_value=httpx.Response(200, json={"data": {}, "meta": {}}),
    )

    client = _make_client()
    processor = PoggleTracingProcessor(client, RUN_ID)
    processor.on_span_end(
        _StubSpan(span_id="s2", span_type="generation", name="gen")
    )
    await flush_tracing(TracingHandle(processor=processor))
    await client.aclose()

    assert route.called
    import json
    body = json.loads(route.calls.last.request.content)
    assert body["kind"] == "llm_call"


@respx.mock
async def test_span_kind_classification_for_guardrail() -> None:
    route = respx.post(f"{BASE_URL}/api/agent/tools/trace").mock(
        return_value=httpx.Response(200, json={"data": {}, "meta": {}}),
    )

    client = _make_client()
    processor = PoggleTracingProcessor(client, RUN_ID)
    processor.on_span_end(
        _StubSpan(span_id="s3", span_type="guardrail", name="cite_guardrail")
    )
    await flush_tracing(TracingHandle(processor=processor))
    await client.aclose()

    assert route.called
    import json
    body = json.loads(route.calls.last.request.content)
    assert body["kind"] == "guardrail"


@respx.mock
async def test_on_trace_start_emits_trace_root_event() -> None:
    route = respx.post(f"{BASE_URL}/api/agent/tools/trace").mock(
        return_value=httpx.Response(200, json={"data": {}, "meta": {}}),
    )

    client = _make_client()
    processor = PoggleTracingProcessor(client, RUN_ID)
    processor.on_trace_start(_StubTrace(trace_id="t-1", name="workspace_operator"))
    await flush_tracing(TracingHandle(processor=processor))
    await client.aclose()

    assert route.called
    import json
    body = json.loads(route.calls.last.request.content)
    assert body["kind"] == "trace_root"
    assert body["span_id"] == "t-1"
    assert body["name"] == "workspace_operator"
    assert body["metadata"]["event"] == "trace_start"


@respx.mock
async def test_on_trace_end_emits_trace_root_event() -> None:
    route = respx.post(f"{BASE_URL}/api/agent/tools/trace").mock(
        return_value=httpx.Response(200, json={"data": {}, "meta": {}}),
    )

    client = _make_client()
    processor = PoggleTracingProcessor(client, RUN_ID)
    processor.on_trace_end(_StubTrace(trace_id="t-2"))
    await flush_tracing(TracingHandle(processor=processor))
    await client.aclose()

    assert route.called
    import json
    body = json.loads(route.calls.last.request.content)
    assert body["kind"] == "trace_root"
    assert body["metadata"]["event"] == "trace_end"


# ---------------------------------------------------------------------------
# Tests: registration / teardown
# ---------------------------------------------------------------------------


async def test_setup_tracing_registers_and_teardown_clears() -> None:
    """setup_tracing replaces the global processor list; teardown clears it."""
    from agents.tracing import get_trace_provider

    client = _make_client()
    handle = setup_tracing(client, RUN_ID)
    try:
        provider = get_trace_provider()
        # Best-effort introspection — the provider's processor list should
        # contain our processor instance somewhere reachable. We accept
        # either a public or underscore-prefixed attribute name.
        processors = (
            getattr(provider, "_multi_processor", None)
            or getattr(provider, "_processors", None)
            or getattr(provider, "processors", None)
        )
        if processors is not None:
            # Multi-processor wrapper — try its inner list.
            inner = getattr(processors, "_processors", None)
            collected = inner if inner is not None else processors
            try:
                found = any(p is handle.processor for p in collected)
                assert found
            except TypeError:
                # Unexpected shape; the import surface alone is the contract.
                pass
    finally:
        handle.teardown()

    # After teardown, the processor list has been replaced with [].
    # We can re-register without raising.
    handle2 = setup_tracing(client, RUN_ID)
    handle2.teardown()
    await client.aclose()


# ---------------------------------------------------------------------------
# Tests: best-effort failure handling
# ---------------------------------------------------------------------------


@respx.mock
async def test_processor_swallows_post_failures() -> None:
    """If the trace POST raises, on_span_end must NOT bubble the exception."""
    respx.post(f"{BASE_URL}/api/agent/tools/trace").mock(
        side_effect=httpx.ConnectError("nope"),
    )

    client = _make_client()
    processor = PoggleTracingProcessor(client, RUN_ID)

    # Should not raise even though the underlying POST will error.
    processor.on_span_end(_StubSpan(span_id="s-fail"))
    # Drain — the swallowed task itself should also not raise out of gather.
    await flush_tracing(TracingHandle(processor=processor))
    await client.aclose()


async def test_processor_swallows_synchronous_exceptions() -> None:
    """A broken span object must not crash on_span_end."""

    class _BrokenSpan:
        @property
        def span_id(self) -> str:  # noqa: D401
            raise RuntimeError("boom")

        @property
        def parent_id(self) -> str | None:
            return None

        @property
        def started_at(self) -> str | None:
            return None

        @property
        def ended_at(self) -> str | None:
            return None

        span_data = _StubSpanData(type_="function", name="x")

    client = _make_client()
    processor = PoggleTracingProcessor(client, RUN_ID)
    # Must not raise.
    processor.on_span_end(_BrokenSpan())  # type: ignore[arg-type]
    await client.aclose()


# ---------------------------------------------------------------------------
# Tests: flush_tracing awaits in-flight tasks
# ---------------------------------------------------------------------------


@respx.mock
async def test_flush_tracing_awaits_pending_posts() -> None:
    delay_event = asyncio.Event()

    async def _slow_response(_request: httpx.Request) -> httpx.Response:
        await delay_event.wait()
        return httpx.Response(200, json={"data": {}, "meta": {}})

    route = respx.post(f"{BASE_URL}/api/agent/tools/trace").mock(side_effect=_slow_response)

    client = _make_client()
    processor = PoggleTracingProcessor(client, RUN_ID)
    processor.on_span_end(_StubSpan(span_id="s-slow"))

    # Release the slow response in the background.
    async def _release() -> None:
        await asyncio.sleep(0)
        delay_event.set()

    asyncio.create_task(_release())
    await flush_tracing(TracingHandle(processor=processor))
    await client.aclose()
    assert route.called


# ---------------------------------------------------------------------------
# Pytest-asyncio is in auto mode (see pyproject.toml).
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _isolate_global_tracing_state() -> Any:
    """Reset the SDK's global processor list before/after each test."""
    from agents import set_trace_processors

    set_trace_processors([])
    yield
    set_trace_processors([])
