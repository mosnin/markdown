"""HTTP-boundary integration tests for the operator's cancel + budget paths.

Existing unit tests in `test_operator_cancel_budget_model.py` mock at the SDK
level (`Runner.run`) and at the *client* level (replacing
`PoggleClient.check_cancellation` with an `AsyncMock`). That gives us
mode-level guarantees but skips the entire HTTP transport: a refactor that
breaks the `/api/agent/operator/check_cancel` envelope, query string, or
header set would slip through unchanged.

This file plugs that gap by exercising the real `PoggleClient` (so the
poller goes through `httpx`) while letting `respx` intercept at the
network boundary. We still mock `Runner.run` — we only care about the
operator's cancel/budget control flow, not actually invoking OpenAI — but
the `check_cancellation` round-trip is the genuine code path the Modal
worker takes in production.

Scenarios:

  1. **cancel mid-run** — first 2 polls return ``cancelled=False``; the 3rd
     returns ``cancelled=True``. The agent task is asyncio-cancelled and
     the run terminates with status ``"cancelled"``.

  2. **budget exceeded** — `max_input_tokens=10`. The mocked Runner
     invokes ``_BudgetHooks.on_llm_end`` with usage > 10 input tokens,
     which raises ``OperatorBudgetExceeded``. We assert the result is
     status=``"failed"`` with the canonical
     ``"Per-run token budget exceeded"`` message (per ``_run_full`` in
     ``operator.py``).

  3. **clean completion** — every poll returns ``cancelled=False``; the
     Runner returns normally; status is ``"completed"`` (no false cancel,
     and the poller is properly cancelled in the ``finally``).

  4. **5xx transient** — first poll returns ``503``; subsequent polls
     return ``cancelled=False`` indefinitely. The poller treats the 5xx as
     "keep going" and the run completes successfully — a single failed
     poll must NOT abort a healthy run (see the ``# Transient errors ->
     keep going`` comment in `_run_with_cancel_poll`).
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import respx

from workspace_operator.client import PoggleClient
from workspace_operator.models import OperatorInput
from workspace_operator.operator import _BudgetHooks, run_operator
from workspace_operator.settings import Settings


# ---------------------------------------------------------------------------
# Shared fixtures / helpers
# ---------------------------------------------------------------------------

BASE_URL = "https://poggle.test"
CANCEL_URL = f"{BASE_URL}/api/agent/operator/check_cancel"


_SETTINGS = Settings(
    poggle_base_url=BASE_URL,
    shared_secret="s" * 40,
    openai_api_key="sk-test",
    model="gpt-4.1-mini",
    request_timeout_s=5.0,
    max_tool_calls=20,
)


_BASE_PAYLOAD = dict(
    run_id="abcdef1234567890",
    user_id="00000000-0000-0000-0000-000000000001",
    workspace_id="11111111-1111-1111-1111-111111111111",
    branch_id="22222222-2222-2222-2222-222222222222",
    box_id="33333333-3333-3333-3333-333333333333",
    prompt="Summarize the competitive landscape",
)


def _make_real_client() -> PoggleClient:
    """Build a genuine `PoggleClient` so respx intercepts the real httpx call."""
    return PoggleClient(
        base_url=BASE_URL,
        shared_secret=_SETTINGS.shared_secret,
        user_id=_BASE_PAYLOAD["user_id"],
        workspace_id=_BASE_PAYLOAD["workspace_id"],
        branch_id=_BASE_PAYLOAD["branch_id"],
        run_id=_BASE_PAYLOAD["run_id"],
        timeout_s=_SETTINGS.request_timeout_s,
    )


def _cancel_envelope(cancelled: bool) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "data": {"run_id": _BASE_PAYLOAD["run_id"], "cancelled": cancelled},
            "meta": {},
        },
    )


def _runner_completion_namespace(
    *, input_tokens: int = 0, output_tokens: int = 0
) -> SimpleNamespace:
    """Build a stand-in for an Agents SDK `RunResult`.

    `_extract_usage` reads either `run_result.usage` or
    `run_result.context_wrapper.usage`; we set the former. `new_items` is
    introspected by `_count_tool_calls` and may be empty for these tests.
    """
    usage = SimpleNamespace(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        input_tokens_details=SimpleNamespace(cached_tokens=0),
    )
    return SimpleNamespace(
        final_output="ok",
        new_items=[],
        usage=usage,
    )


# ---------------------------------------------------------------------------
# 1. Cancel mid-run — poller observes True after 2 False responses.
# ---------------------------------------------------------------------------


@respx.mock
@patch("workspace_operator.operator.setup_tracing", return_value=None)
@patch("workspace_operator.operator.flush_tracing", new_callable=AsyncMock)
@patch("workspace_operator.operator._CANCEL_POLL_INTERVAL_S", 0.05)
@patch("workspace_operator.operator._make_client")
@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_cancel_midrun_terminates_with_cancelled_status(
    mock_runner_run: AsyncMock,
    mock_make_client: MagicMock,
    mock_flush: AsyncMock,
    mock_setup: MagicMock,
) -> None:
    """First two polls say not-cancelled; the third flips True; the in-flight
    Runner is cancelled and the operator returns status=``cancelled``."""

    # Slow Runner so the poller has time to fire 2-3 times.
    async def slow_runner(*_a: object, **_kw: object) -> object:
        await asyncio.sleep(2.0)
        return _runner_completion_namespace()

    mock_runner_run.side_effect = slow_runner

    # respx serves: False, False, True (then True forever for safety).
    route = respx.get(CANCEL_URL).mock(
        side_effect=[
            _cancel_envelope(False),
            _cancel_envelope(False),
            _cancel_envelope(True),
            _cancel_envelope(True),
            _cancel_envelope(True),
        ]
    )

    # Use a real `PoggleClient` for both _make_client calls so all HTTP
    # exits the operator → respx and is observable.
    mock_make_client.side_effect = lambda *_a, **_kw: _make_real_client()

    payload = OperatorInput.model_validate(_BASE_PAYLOAD)

    # Tight outer timeout — anything that hangs here is a regression in the
    # poller's fail-fast contract.
    result = await asyncio.wait_for(run_operator(payload, _SETTINGS), timeout=5.0)

    assert result.status == "cancelled"
    assert result.model == "gpt-4.1-mini"
    # Poller must have hit the endpoint at least the 3 times we modelled.
    assert route.call_count >= 3
    # Sanity: the request really went over the wire as a GET with the run_id
    # query param (i.e. we're exercising the HTTP boundary, not a stub).
    last_req = route.calls.last.request
    assert last_req.method == "GET"
    assert _BASE_PAYLOAD["run_id"] in last_req.url.query.decode()
    assert last_req.headers["x-workspace-operator-secret"] == _SETTINGS.shared_secret


# ---------------------------------------------------------------------------
# 2. Budget exceeded — _BudgetHooks raises -> status="failed".
# ---------------------------------------------------------------------------


@respx.mock
@patch("workspace_operator.operator.setup_tracing", return_value=None)
@patch("workspace_operator.operator.flush_tracing", new_callable=AsyncMock)
@patch("workspace_operator.operator._CANCEL_POLL_INTERVAL_S", 0.05)
@patch("workspace_operator.operator._make_client")
@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_budget_exceeded_returns_failed_with_canonical_error(
    mock_runner_run: AsyncMock,
    mock_make_client: MagicMock,
    mock_flush: AsyncMock,
    mock_setup: MagicMock,
) -> None:
    """With `max_input_tokens=10`, simulate the agent emitting >10 input
    tokens — the budget hook trips and the run resolves to status=``failed``
    with the canonical ``"Per-run token budget exceeded"`` error string."""

    # The mocked Runner stands in for the SDK loop: it pulls the hooks
    # kwarg out of the call and feeds it a usage context > the cap, which
    # is exactly what `_BudgetHooks.on_llm_end` is built to react to.
    async def runner_invoking_hook(*_a: object, **kwargs: object) -> object:
        hooks = kwargs.get("hooks")
        assert isinstance(hooks, _BudgetHooks), (
            "operator must pass _BudgetHooks; got "
            f"{type(hooks).__name__ if hooks is not None else 'None'}"
        )
        # >10 input tokens — past the cap configured below.
        ctx = SimpleNamespace(
            usage=SimpleNamespace(
                input_tokens=42,
                output_tokens=5,
                input_tokens_details=SimpleNamespace(cached_tokens=0),
            )
        )
        await hooks.on_llm_end(ctx, MagicMock(), MagicMock())  # raises
        # Unreachable — kept for documentation: if the hook ever stops
        # raising, the test fails on the assertion below rather than
        # silently regressing.
        return _runner_completion_namespace()

    mock_runner_run.side_effect = runner_invoking_hook

    # Phase-boundary cancel check + (potentially) the poller. All False so
    # cancellation never confounds the budget signal.
    respx.get(CANCEL_URL).mock(return_value=_cancel_envelope(False))

    mock_make_client.side_effect = lambda *_a, **_kw: _make_real_client()

    payload = OperatorInput.model_validate(
        {**_BASE_PAYLOAD, "max_input_tokens": 10}
    )

    result = await asyncio.wait_for(run_operator(payload, _SETTINGS), timeout=5.0)

    assert result.status == "failed"
    assert result.error == "Per-run token budget exceeded"
    assert result.input_tokens == 42
    assert result.output_tokens == 5
    assert result.model == "gpt-4.1-mini"


# ---------------------------------------------------------------------------
# 3. Clean completion — poller never sees a True, run completes normally.
# ---------------------------------------------------------------------------


@respx.mock
@patch("workspace_operator.operator.setup_tracing", return_value=None)
@patch("workspace_operator.operator.flush_tracing", new_callable=AsyncMock)
@patch("workspace_operator.operator._CANCEL_POLL_INTERVAL_S", 0.05)
@patch("workspace_operator.operator._make_client")
@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_clean_completion_no_false_cancel(
    mock_runner_run: AsyncMock,
    mock_make_client: MagicMock,
    mock_flush: AsyncMock,
    mock_setup: MagicMock,
) -> None:
    """Endpoint always answers cancelled=False; the run completes happily."""
    # Brief sleep so the poller wakes at least once before completion.
    async def runner(*_a: object, **_kw: object) -> object:
        await asyncio.sleep(0.15)
        return _runner_completion_namespace(input_tokens=100, output_tokens=20)

    mock_runner_run.side_effect = runner

    route = respx.get(CANCEL_URL).mock(return_value=_cancel_envelope(False))
    mock_make_client.side_effect = lambda *_a, **_kw: _make_real_client()

    payload = OperatorInput.model_validate(_BASE_PAYLOAD)

    result = await asyncio.wait_for(run_operator(payload, _SETTINGS), timeout=5.0)

    assert result.status == "completed", (
        f"expected completed run; got status={result.status} error={result.error}"
    )
    assert result.input_tokens == 100
    assert result.output_tokens == 20
    assert result.model == "gpt-4.1-mini"
    # The poller AND the phase-boundary check both hit the endpoint, so
    # we expect ≥1 call. (Phase-boundary alone may suffice if the runner
    # finishes between poll wakeups; either way ≥1.)
    assert route.call_count >= 1


# ---------------------------------------------------------------------------
# 4. Transient 5xx — poller swallows the error, run completes anyway.
# ---------------------------------------------------------------------------


@respx.mock
@patch("workspace_operator.operator.setup_tracing", return_value=None)
@patch("workspace_operator.operator.flush_tracing", new_callable=AsyncMock)
@patch("workspace_operator.operator._CANCEL_POLL_INTERVAL_S", 0.05)
@patch("workspace_operator.operator._make_client")
@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_check_cancel_5xx_does_not_abort_healthy_run(
    mock_runner_run: AsyncMock,
    mock_make_client: MagicMock,
    mock_flush: AsyncMock,
    mock_setup: MagicMock,
) -> None:
    """A single 5xx from the cancel endpoint is treated as 'keep going'.

    The phase-boundary `_was_cancelled` check fires first (before the
    Runner starts) and must also tolerate 5xx — both code paths swallow
    transient errors with `return False`. We model:

      * call 1 (phase-boundary): 503
      * calls 2..n (poller while Runner sleeps briefly): cancelled=False

    so the very first request the operator makes is the failing one.
    """
    async def runner(*_a: object, **_kw: object) -> object:
        await asyncio.sleep(0.25)  # let the poller wake at least once
        return _runner_completion_namespace(input_tokens=50, output_tokens=5)

    mock_runner_run.side_effect = runner

    # First call = 503; all subsequent = cancelled=False.
    route = respx.get(CANCEL_URL).mock(
        side_effect=[
            httpx.Response(503, json={"error_code": "internal_error", "message": "DB down"}),
            _cancel_envelope(False),
            _cancel_envelope(False),
            _cancel_envelope(False),
            _cancel_envelope(False),
            _cancel_envelope(False),
            _cancel_envelope(False),
        ]
    )
    mock_make_client.side_effect = lambda *_a, **_kw: _make_real_client()

    payload = OperatorInput.model_validate(_BASE_PAYLOAD)

    result = await asyncio.wait_for(run_operator(payload, _SETTINGS), timeout=5.0)

    # The 5xx must NOT have flipped the run into failed/cancelled.
    assert result.status == "completed", (
        f"single 5xx poll must not abort the run; got status={result.status} "
        f"error={result.error}"
    )
    # And we really did exercise the failing path: the first call returned 503.
    assert route.call_count >= 1
    first_call = route.calls[0]
    assert first_call.response.status_code == 503
