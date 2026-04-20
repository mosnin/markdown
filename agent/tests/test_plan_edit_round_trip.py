"""Plan-edit round-trip — Python execute entrypoint preserves edited descriptions.

This is the agent-side counterpart to
`src/tests/unit/operator_plan_edit_round_trip.test.ts`. The Vitest test asserts
the dispatcher serialises edited steps onto the wire; this test asserts the
Python operator deserialises them and threads them into the prompt verbatim.

Approach: patch `workspace_operator.operator.Runner.run` with a fake that
captures the second positional argument (the agent's user prompt) so we can
assert the edited descriptions appear in the constructed prompt without
spinning up a real LLM. The `_make_client` factory is also patched so we
never touch the network for tool-call sidechannels.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from workspace_operator.models import OperatorInput
from workspace_operator.operator import _build_execute_prompt, run_operator
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
    run_id="round-trip-edit-0001",
    user_id="u",
    workspace_id="w",
    branch_id="b",
    box_id="bx",
    prompt="Draft a brief on our Q1 roadmap",
)

# Match the descriptions used in the Vitest counterpart so a developer
# reading both side-by-side sees the same fixture data flow end-to-end.
_EDITED_STEPS = [
    {
        "index": 0,
        "description": "USER-EDITED: search the EU competitive landscape only",
        "tool": "hybrid_search",
    },
    {
        "index": 1,
        "description": "USER-EDITED: draft a one-page customer-facing brief",
        "tool": "draft_note",
    },
]


# ---------------------------------------------------------------------------
# Pure builder — exercises the prompt construction directly so a regression
# in `_build_execute_prompt` is caught even if the integration test below
# is skipped or short-circuits.
# ---------------------------------------------------------------------------


def test_build_execute_prompt_includes_edited_descriptions_verbatim() -> None:
    """`_build_execute_prompt` must inline edited step descriptions byte-for-byte."""
    payload = OperatorInput.model_validate(
        {**_BASE_PAYLOAD, "mode": "execute", "approved_plan": _EDITED_STEPS}
    )
    prompt = _build_execute_prompt(payload.prompt, payload.approved_plan)

    # Original user prompt is preserved as the lead.
    assert payload.prompt in prompt
    # Each edited description appears verbatim — no truncation, no rewording.
    for step in _EDITED_STEPS:
        assert step["description"] in prompt
    # The tool tags also survive so the agent knows which tool to invoke per step.
    assert "[hybrid_search]" in prompt
    assert "[draft_note]" in prompt


# ---------------------------------------------------------------------------
# Integration — the execute entrypoint runs end-to-end with a fake Runner
# that captures the prompt the SDK would have sent to the model.
# ---------------------------------------------------------------------------


async def test_execute_entrypoint_threads_edited_descriptions_into_runner_prompt() -> None:
    """run_operator(mode='execute', approved_plan=edited) must hand the
    fake Runner a prompt that contains every edited description verbatim."""
    captured: dict[str, object] = {}

    async def fake_runner_run(agent, prompt, **kwargs):  # type: ignore[no-untyped-def]
        captured["agent"] = agent
        captured["prompt"] = prompt
        captured["kwargs"] = kwargs
        return SimpleNamespace(
            final_output="Drafted [[note-1]].",
            new_items=[],
        )

    payload = OperatorInput.model_validate(
        {**_BASE_PAYLOAD, "mode": "execute", "approved_plan": _EDITED_STEPS}
    )

    with (
        patch("workspace_operator.operator.Runner.run", new=fake_runner_run),
        patch("workspace_operator.operator._make_client") as mock_make_client,
    ):
        mock_client = AsyncMock()
        mock_client.draft_note = AsyncMock()
        mock_client.report_progress = AsyncMock()
        mock_client.check_cancellation = AsyncMock(return_value=False)
        mock_client.aclose = AsyncMock()
        mock_make_client.return_value = mock_client

        result = await run_operator(payload, _SETTINGS)

    assert result.status == "completed"
    assert "prompt" in captured, "Fake Runner.run was never invoked"
    constructed_prompt = captured["prompt"]
    assert isinstance(constructed_prompt, str)

    # Original user prompt survives.
    assert _BASE_PAYLOAD["prompt"] in constructed_prompt
    # Edited descriptions reach the model verbatim — this is the load-bearing
    # assertion: if the dispatcher, pydantic model, or prompt builder ever
    # silently substitutes the planner's pre-edit text, this fails.
    for step in _EDITED_STEPS:
        assert step["description"] in constructed_prompt, (
            f"Edited description missing from prompt: {step['description']!r}"
        )

    # Sanity: progress was reported per edited step using the user's index +
    # description, not stale planner state.
    progress_calls = mock_client.report_progress.call_args_list
    step_starts = [c for c in progress_calls if c.kwargs.get("event_type") == "step_start"]
    assert [c.kwargs["detail"] for c in step_starts] == [
        s["description"] for s in _EDITED_STEPS
    ]
