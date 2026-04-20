"""Phase 4 — run_operator propagates token usage onto the OperatorResult.

These tests pin the contract between the Python agent and the Next.js side:
the `input_tokens`, `output_tokens`, `cached_input_tokens`, and `model`
fields on `OperatorResult` must be populated when the SDK surfaces usage,
and must fall back to zero/None cleanly when it does not.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from workspace_operator.models import OperatorInput
from workspace_operator.operator import run_operator
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


def _with_usage(
    *,
    input_tokens: int,
    output_tokens: int,
    cached_tokens: int,
) -> SimpleNamespace:
    """Build a mock RunResult shaped like SDK ≥0.x (context_wrapper.usage)."""
    return SimpleNamespace(
        final_output="Drafted a note citing [[note-1]].",
        new_items=[],
        context_wrapper=SimpleNamespace(
            usage=SimpleNamespace(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                input_tokens_details=SimpleNamespace(cached_tokens=cached_tokens),
            )
        ),
    )


# ---------------------------------------------------------------------------
# Usage capture wired through to OperatorResult
# ---------------------------------------------------------------------------


@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_full_mode_populates_token_usage(mock_runner_run: AsyncMock) -> None:
    """Full mode sets input_tokens, output_tokens, cached_input_tokens, model."""
    mock_runner_run.return_value = _with_usage(
        input_tokens=2500,
        output_tokens=400,
        cached_tokens=1900,
    )
    payload = OperatorInput.model_validate(_BASE_PAYLOAD)
    result = await run_operator(payload, _SETTINGS)

    assert result.status == "completed"
    assert result.input_tokens == 2500
    assert result.output_tokens == 400
    assert result.cached_input_tokens == 1900
    assert result.model == "gpt-4.1-mini"


@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_full_mode_zero_usage_when_sdk_omits_it(
    mock_runner_run: AsyncMock,
) -> None:
    """Missing usage -> token fields default to 0 (no crash)."""
    mock_runner_run.return_value = SimpleNamespace(
        final_output="Drafted note citing [[note-1]].",
        new_items=[],
    )
    payload = OperatorInput.model_validate(_BASE_PAYLOAD)
    result = await run_operator(payload, _SETTINGS)

    assert result.status == "completed"
    assert result.input_tokens == 0
    assert result.output_tokens == 0
    assert result.cached_input_tokens == 0
    # Even without usage, we still tag the result with the model we asked for.
    assert result.model == "gpt-4.1-mini"


@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_plan_mode_populates_token_usage(mock_runner_run: AsyncMock) -> None:
    """Plan mode also surfaces tokens so quota checks are accurate."""
    import json

    plan_json = json.dumps(
        {
            "steps": [
                {"index": 0, "description": "Search", "tool": "hybrid_search"},
            ],
            "summary": "Quick search.",
        }
    )
    mock_runner_run.return_value = SimpleNamespace(
        final_output=plan_json,
        new_items=[],
        context_wrapper=SimpleNamespace(
            usage=SimpleNamespace(
                input_tokens=900,
                output_tokens=120,
                input_tokens_details=SimpleNamespace(cached_tokens=0),
            )
        ),
    )
    payload = OperatorInput.model_validate({**_BASE_PAYLOAD, "mode": "plan"})
    result = await run_operator(payload, _SETTINGS)

    assert result.status == "completed"
    assert result.input_tokens == 900
    assert result.output_tokens == 120
    assert result.cached_input_tokens == 0
    assert result.model == "gpt-4.1-mini"
