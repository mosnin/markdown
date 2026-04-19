"""Model-validation smoke tests."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from workspace_operator.models import OperatorInput, OperatorResult


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
