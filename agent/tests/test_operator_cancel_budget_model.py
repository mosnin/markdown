"""Wave 1 F — cancellation, budget, model validation tests for the operator.

These exercise the additions made to `workspace_operator.operator`:

  * `OperatorCancelled`     — raised when check_cancellation flips True
  * `OperatorBudgetExceeded`— raised by `_BudgetHooks` when usage exceeds caps
  * `_resolve_model`        — picks per-run > settings, validates against allow-list

We mock both `Runner.run` and `_make_client` to avoid real network / OpenAI
traffic; the focus is on the wrapper logic, not the SDK.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from workspace_operator.models import OperatorInput
from workspace_operator.operator import (
    OperatorBudgetExceeded,
    OperatorCancelled,
    _BudgetHooks,
    _resolve_model,
    _was_cancelled,
    run_operator,
)
from workspace_operator.settings import Settings


_SETTINGS = Settings(
    poggle_base_url="https://poggle.test",
    shared_secret="s" * 40,
    openai_api_key="sk-test",
    model="gpt-4.1-mini",
    request_timeout_s=30.0,
    max_tool_calls=20,
)

_BASE_PAYLOAD = dict(
    run_id="abcdef1234567890",
    user_id="u",
    workspace_id="w",
    branch_id="b",
    box_id="bx",
    prompt="Summarize the competitive landscape",
)


def _usage_namespace(input_tokens: int, output_tokens: int) -> SimpleNamespace:
    return SimpleNamespace(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        input_tokens_details=SimpleNamespace(cached_tokens=0),
    )


def _ctx_with_usage(input_tokens: int, output_tokens: int) -> SimpleNamespace:
    return SimpleNamespace(usage=_usage_namespace(input_tokens, output_tokens))


# ---------------------------------------------------------------------------
# _resolve_model
# ---------------------------------------------------------------------------


def test_resolve_model_falls_back_to_settings_when_payload_omits() -> None:
    payload = OperatorInput.model_validate(_BASE_PAYLOAD)
    assert _resolve_model(payload, _SETTINGS) == "gpt-4.1-mini"


def test_resolve_model_uses_payload_override_when_set() -> None:
    payload = OperatorInput.model_validate({**_BASE_PAYLOAD, "model": "gpt-4.1"})
    assert _resolve_model(payload, _SETTINGS) == "gpt-4.1"


def test_resolve_model_rejects_unknown_model_with_value_error() -> None:
    payload = OperatorInput.model_validate(
        {**_BASE_PAYLOAD, "model": "claude-1-billion"}
    )
    with pytest.raises(ValueError, match="ALLOWED_OPERATOR_MODELS"):
        _resolve_model(payload, _SETTINGS)


# Top-level run_operator should turn that ValueError into a clean
# status="failed" result rather than crashing the Modal handler.
async def test_run_operator_returns_failed_for_invalid_model() -> None:
    payload = OperatorInput.model_validate(
        {**_BASE_PAYLOAD, "model": "claude-1-billion"}
    )
    result = await run_operator(payload, _SETTINGS)
    assert result.status == "failed"
    assert result.error is not None
    assert "invalid_model" in result.error
    # Unknown model id is still echoed back so the UI can show what it tried.
    assert result.model == "claude-1-billion"


# ---------------------------------------------------------------------------
# _BudgetHooks
# ---------------------------------------------------------------------------


async def test_budget_hooks_no_budget_never_raises() -> None:
    hooks = _BudgetHooks(max_input_tokens=None, max_output_tokens=None)
    ctx = _ctx_with_usage(input_tokens=1_000_000, output_tokens=1_000_000)
    # Should not raise no matter how much we spent.
    await hooks.on_llm_end(ctx, MagicMock(), MagicMock())
    await hooks.on_tool_end(ctx, MagicMock(), MagicMock(), "ok")


async def test_budget_hooks_input_cap_exceeded_raises() -> None:
    hooks = _BudgetHooks(max_input_tokens=1000, max_output_tokens=None)
    ctx = _ctx_with_usage(input_tokens=1500, output_tokens=10)
    with pytest.raises(OperatorBudgetExceeded) as excinfo:
        await hooks.on_llm_end(ctx, MagicMock(), MagicMock())
    assert excinfo.value.used_input == 1500
    assert excinfo.value.max_input == 1000


async def test_budget_hooks_output_cap_exceeded_raises() -> None:
    hooks = _BudgetHooks(max_input_tokens=None, max_output_tokens=200)
    ctx = _ctx_with_usage(input_tokens=10, output_tokens=500)
    with pytest.raises(OperatorBudgetExceeded):
        await hooks.on_tool_end(ctx, MagicMock(), MagicMock(), "ok")


async def test_budget_hooks_under_cap_does_not_raise() -> None:
    hooks = _BudgetHooks(max_input_tokens=2000, max_output_tokens=500)
    ctx = _ctx_with_usage(input_tokens=1500, output_tokens=400)
    await hooks.on_llm_end(ctx, MagicMock(), MagicMock())
    # No exception -> we're good.


# ---------------------------------------------------------------------------
# Cancellation — phase boundary
# ---------------------------------------------------------------------------


async def test_was_cancelled_true_when_endpoint_returns_true() -> None:
    client = AsyncMock()
    client.check_cancellation = AsyncMock(return_value=True)
    assert await _was_cancelled(client, "run-1") is True


async def test_was_cancelled_false_when_endpoint_returns_false() -> None:
    client = AsyncMock()
    client.check_cancellation = AsyncMock(return_value=False)
    assert await _was_cancelled(client, "run-1") is False


async def test_was_cancelled_false_on_network_error() -> None:
    client = AsyncMock()
    client.check_cancellation = AsyncMock(side_effect=RuntimeError("net down"))
    # Transient errors must not fake-cancel.
    assert await _was_cancelled(client, "run-1") is False


async def test_was_cancelled_false_for_non_bool_payloads() -> None:
    """Defence-in-depth: a stray dict / Mock from a half-broken envelope is
    treated as not-cancelled, never as cancelled."""
    client = AsyncMock()
    client.check_cancellation = AsyncMock(return_value={"unexpected": "shape"})
    assert await _was_cancelled(client, "run-1") is False


# ---------------------------------------------------------------------------
# Cancellation — full mode end-to-end
# ---------------------------------------------------------------------------


@patch("workspace_operator.operator._make_client")
@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_full_mode_cancelled_before_run_returns_cancelled_status(
    mock_runner_run: AsyncMock,
    mock_make_client: MagicMock,
) -> None:
    """If the user clicked Cancel before we even started, skip the model call."""
    mock_client = AsyncMock()
    mock_client.check_cancellation = AsyncMock(return_value=True)
    mock_client.draft_note = AsyncMock()
    mock_client.aclose = AsyncMock()
    mock_make_client.return_value = mock_client

    payload = OperatorInput.model_validate(_BASE_PAYLOAD)
    result = await run_operator(payload, _SETTINGS)

    assert result.status == "cancelled"
    assert result.notes_created == []
    assert result.model == "gpt-4.1-mini"
    # No model call should have happened.
    assert not mock_runner_run.called


@patch("workspace_operator.operator._CANCEL_POLL_INTERVAL_S", 0.01)
@patch("workspace_operator.operator._make_client")
@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_full_mode_cancelled_mid_run_returns_partial_artifacts(
    mock_runner_run: AsyncMock,
    mock_make_client: MagicMock,
) -> None:
    """Cancellation polled mid-Runner.run aborts and surfaces partial notes."""

    async def slow_runner(*_args: object, **_kwargs: object) -> object:
        # Long enough that the poller fires at least twice.
        await asyncio.sleep(0.2)
        return SimpleNamespace(final_output="should not get here", new_items=[])

    mock_runner_run.side_effect = slow_runner

    # Two polls: first returns False, second returns True.
    cancel_responses = [False, True, True]

    async def fake_check(_run_id: str) -> bool:
        return cancel_responses.pop(0) if cancel_responses else True

    mock_client = AsyncMock()
    mock_client.check_cancellation = fake_check  # type: ignore[assignment]
    mock_client.draft_note = AsyncMock()
    mock_client.aclose = AsyncMock()
    mock_make_client.return_value = mock_client

    payload = OperatorInput.model_validate(_BASE_PAYLOAD)
    result = await run_operator(payload, _SETTINGS)

    assert result.status == "cancelled"
    assert result.model == "gpt-4.1-mini"


# ---------------------------------------------------------------------------
# Budget — full mode end-to-end (hooks raise -> status="failed", partial)
# ---------------------------------------------------------------------------


@patch("workspace_operator.operator._make_client")
@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_full_mode_budget_exceeded_returns_failed_with_partial(
    mock_runner_run: AsyncMock,
    mock_make_client: MagicMock,
) -> None:
    """When `_BudgetHooks` raises, we surface status=failed + partial artifacts."""
    mock_runner_run.side_effect = OperatorBudgetExceeded(
        used_input=2500, used_output=1000, max_input=2000, max_output=None,
    )

    mock_client = AsyncMock()
    mock_client.check_cancellation = AsyncMock(return_value=False)
    mock_client.draft_note = AsyncMock()
    mock_client.aclose = AsyncMock()
    mock_make_client.return_value = mock_client

    payload = OperatorInput.model_validate(
        {**_BASE_PAYLOAD, "max_input_tokens": 2000}
    )
    result = await run_operator(payload, _SETTINGS)

    assert result.status == "failed"
    assert result.error == "Per-run token budget exceeded"
    assert result.input_tokens == 2500
    assert result.output_tokens == 1000
    assert result.model == "gpt-4.1-mini"
