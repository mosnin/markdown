"""Model-validation smoke tests."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from workspace_operator.models import (
    OperatorInput,
    OperatorResult,
    PlanResult,
    PlanStep,
)


def test_operator_input_roundtrip() -> None:
    raw = {
        "run_id": "abcdef123456",
        "user_id": "u",
        "workspace_id": "w",
        "branch_id": "b",
        "box_id": "bx",
        "prompt": "hello",
    }
    parsed = OperatorInput.model_validate(raw)
    assert parsed.run_id == "abcdef123456"
    assert parsed.prompt == "hello"


def test_operator_input_rejects_short_run_id() -> None:
    with pytest.raises(ValidationError):
        OperatorInput.model_validate(
            {
                "run_id": "short",
                "user_id": "u",
                "workspace_id": "w",
                "branch_id": "b",
                "box_id": "bx",
                "prompt": "hello",
            }
        )


def test_operator_result_defaults() -> None:
    result = OperatorResult(run_id="abcdef123456", status="completed")
    assert result.notes_created == []
    assert result.tool_calls == 0
    assert result.error is None


# ---------------------------------------------------------------------------
# Phase 2: plan types
# ---------------------------------------------------------------------------


def test_plan_step_roundtrip() -> None:
    step = PlanStep(index=0, description="Search for roadmap notes", tool="hybrid_search")
    assert step.index == 0
    assert step.description == "Search for roadmap notes"
    assert step.tool == "hybrid_search"
    # Round-trip through dict
    restored = PlanStep.model_validate(step.model_dump())
    assert restored == step


def test_plan_result_roundtrip() -> None:
    steps = [
        PlanStep(index=0, description="Search competitive context", tool="hybrid_search"),
        PlanStep(index=1, description="Draft competitive brief", tool="draft_note"),
    ]
    plan = PlanResult(run_id="run123456ab", steps=steps, summary="Search then draft.")
    assert plan.run_id == "run123456ab"
    assert len(plan.steps) == 2
    assert plan.summary == "Search then draft."
    # Round-trip through JSON
    restored = PlanResult.model_validate_json(plan.model_dump_json())
    assert restored == plan


def test_operator_input_defaults_to_full_mode() -> None:
    inp = OperatorInput.model_validate(
        {
            "run_id": "abcdef123456",
            "user_id": "u",
            "workspace_id": "w",
            "branch_id": "b",
            "box_id": "bx",
            "prompt": "hello",
        }
    )
    assert inp.mode == "full"
    assert inp.approved_plan is None


def test_operator_input_accepts_plan_mode() -> None:
    steps = [
        {"index": 0, "description": "Search notes", "tool": "hybrid_search"},
        {"index": 1, "description": "Draft summary", "tool": "draft_note"},
    ]
    inp = OperatorInput.model_validate(
        {
            "run_id": "abcdef123456",
            "user_id": "u",
            "workspace_id": "w",
            "branch_id": "b",
            "box_id": "bx",
            "prompt": "Summarize my notes",
            "mode": "execute",
            "approved_plan": steps,
        }
    )
    assert inp.mode == "execute"
    assert inp.approved_plan is not None
    assert len(inp.approved_plan) == 2
    assert inp.approved_plan[0].tool == "hybrid_search"


def test_operator_result_with_plan() -> None:
    steps = [
        PlanStep(index=0, description="Search notes", tool="hybrid_search"),
    ]
    plan = PlanResult(run_id="abcdef123456", steps=steps, summary="Search first.")
    result = OperatorResult(
        run_id="abcdef123456",
        status="completed",
        plan=plan,
    )
    assert result.plan is not None
    assert result.plan.summary == "Search first."
    assert len(result.plan.steps) == 1
