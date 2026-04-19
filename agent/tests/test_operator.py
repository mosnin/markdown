"""Unit tests for the Workspace Operator plan/execute modes."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from workspace_operator.models import OperatorInput, PlanStep
from workspace_operator.operator import _parse_plan, run_operator
from workspace_operator.settings import Settings


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

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
    prompt="Summarize competitive landscape",
)


def _plan_payload(**overrides: object) -> OperatorInput:
    return OperatorInput.model_validate({**_BASE_PAYLOAD, "mode": "plan", **overrides})


def _execute_payload(**overrides: object) -> OperatorInput:
    steps = [
        {"index": 0, "description": "Search competitive notes", "tool": "hybrid_search"},
        {"index": 1, "description": "Search product roadmap", "tool": "hybrid_search"},
        {"index": 2, "description": "Draft competitive brief", "tool": "draft_note"},
    ]
    return OperatorInput.model_validate(
        {**_BASE_PAYLOAD, "mode": "execute", "approved_plan": steps, **overrides}
    )


# ---------------------------------------------------------------------------
# _parse_plan tests
# ---------------------------------------------------------------------------


def test_run_plan_parses_json_output() -> None:
    """Valid JSON from the agent is parsed into a PlanResult."""
    raw = json.dumps(
        {
            "steps": [
                {"index": 0, "description": "Search competitive notes", "tool": "hybrid_search"},
                {"index": 1, "description": "Draft brief", "tool": "draft_note"},
            ],
            "summary": "Search then draft.",
        }
    )
    plan = _parse_plan("run-abc12345", raw)
    assert plan.run_id == "run-abc12345"
    assert len(plan.steps) == 2
    assert plan.steps[0].tool == "hybrid_search"
    assert plan.steps[1].tool == "draft_note"
    assert plan.summary == "Search then draft."


def test_run_plan_handles_fenced_json() -> None:
    """JSON wrapped in markdown code fences is extracted correctly."""
    raw = (
        "Here is the plan:\n```json\n"
        '{"steps": [{"index": 0, "description": "Search", "tool": "hybrid_search"}], '
        '"summary": "Quick search."}\n```'
    )
    plan = _parse_plan("run-abc12345", raw)
    assert len(plan.steps) == 1
    assert plan.summary == "Quick search."


def test_run_plan_handles_malformed_json() -> None:
    """Completely malformed output raises ValueError."""
    with pytest.raises(ValueError, match="Could not parse plan JSON"):
        _parse_plan("run-abc12345", "This is not JSON at all.")


def test_run_plan_extracts_embedded_json() -> None:
    """JSON embedded in prose (no fences) is found and parsed."""
    raw = (
        'Some preamble text\n{"steps": [{"index": 0, "description": "Search", '
        '"tool": "hybrid_search"}], "summary": "A plan."}\nSome trailing text'
    )
    plan = _parse_plan("run-abc12345", raw)
    assert len(plan.steps) == 1
    assert plan.summary == "A plan."


# ---------------------------------------------------------------------------
# run_operator plan mode (integration with mocked Runner)
# ---------------------------------------------------------------------------


@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_run_operator_plan_mode(mock_runner_run: AsyncMock) -> None:
    """Plan mode returns an OperatorResult with a populated plan field."""
    plan_json = json.dumps(
        {
            "steps": [
                {"index": 0, "description": "Search notes", "tool": "hybrid_search"},
                {"index": 1, "description": "Draft summary", "tool": "draft_note"},
            ],
            "summary": "Search then draft.",
        }
    )
    mock_runner_run.return_value = SimpleNamespace(
        final_output=plan_json,
        new_items=[],
    )

    payload = _plan_payload()
    result = await run_operator(payload, _SETTINGS)

    assert result.status == "completed"
    assert result.plan is not None
    assert len(result.plan.steps) == 2
    assert result.plan.summary == "Search then draft."
    assert result.notes_created == []


@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_run_operator_plan_mode_bad_json_raises(mock_runner_run: AsyncMock) -> None:
    """Plan mode with unparseable agent output raises ValueError."""
    mock_runner_run.return_value = SimpleNamespace(
        final_output="No JSON here.",
        new_items=[],
    )

    payload = _plan_payload()
    with pytest.raises(ValueError, match="Could not parse plan JSON"):
        await run_operator(payload, _SETTINGS)


# ---------------------------------------------------------------------------
# run_operator execute mode
# ---------------------------------------------------------------------------


@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_run_execute_reports_progress(mock_runner_run: AsyncMock) -> None:
    """Execute mode calls report_progress for step_start, step_complete, and completed."""
    mock_runner_run.return_value = SimpleNamespace(
        final_output="Done! I drafted the brief citing [[note-1]].",
        new_items=[],
    )

    payload = _execute_payload()

    with patch("workspace_operator.operator._make_client") as mock_make_client:
        mock_client = AsyncMock()
        mock_client.draft_note = AsyncMock()
        mock_client.report_progress = AsyncMock()
        mock_client.aclose = AsyncMock()
        mock_make_client.return_value = mock_client

        result = await run_operator(payload, _SETTINGS)

    assert result.status == "completed"

    # Verify progress calls: 3 step_starts + 3 step_completes + 1 completed = 7
    progress_calls = mock_client.report_progress.call_args_list
    event_types = [call.kwargs["event_type"] for call in progress_calls]

    assert event_types.count("step_start") == 3
    assert event_types.count("step_complete") == 3
    assert event_types.count("completed") == 1

    # Verify step_start calls come with correct step indices
    step_start_calls = [c for c in progress_calls if c.kwargs["event_type"] == "step_start"]
    step_start_indices = [c.kwargs["step_index"] for c in step_start_calls]
    assert step_start_indices == [0, 1, 2]


@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_run_execute_without_plan_fails(mock_runner_run: AsyncMock) -> None:
    """Execute mode without an approved_plan returns a failed result."""
    payload = OperatorInput.model_validate({**_BASE_PAYLOAD, "mode": "execute"})

    result = await run_operator(payload, _SETTINGS)

    assert result.status == "failed"
    assert result.error == "execute mode requires approved_plan"
    mock_runner_run.assert_not_called()


# ---------------------------------------------------------------------------
# run_operator full mode (Phase 1 backward compat)
# ---------------------------------------------------------------------------


@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_run_operator_full_mode_backward_compat(mock_runner_run: AsyncMock) -> None:
    """Full mode (default) still works the same as Phase 1."""
    mock_runner_run.return_value = SimpleNamespace(
        final_output="Drafted a note citing [[note-1]].",
        new_items=[],
    )

    payload = OperatorInput.model_validate(_BASE_PAYLOAD)
    assert payload.mode == "full"

    result = await run_operator(payload, _SETTINGS)

    assert result.status == "completed"
    assert result.plan is None
