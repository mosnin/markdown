"""Phase 3 guardrail tests — must_cite_per_claim + max_tool_calls."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from workspace_operator.guardrails.max_tool_calls import (
    ToolCallBudgetExceeded,
    check_tool_call_budget,
    derive_max_turns,
)
from workspace_operator.guardrails.must_cite_per_claim import (
    _parse_checker_output,
    build_must_cite_per_claim_guardrail,
)
from workspace_operator.models import OperatorInput
from workspace_operator.operator import run_operator
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


async def _invoke_per_claim(output: str) -> tuple[bool, dict]:
    """Call the must_cite_per_claim guardrail's underlying function."""
    g = build_must_cite_per_claim_guardrail()
    inner = (
        getattr(g, "guardrail_function", None)
        or getattr(g, "_func", None)
        or g
    )
    result = await inner(None, None, output)
    return result.tripwire_triggered, result.output_info or {}


# ---------------------------------------------------------------------------
# _parse_checker_output unit tests
# ---------------------------------------------------------------------------


def test_parse_checker_output_direct_json() -> None:
    parsed = _parse_checker_output('{"all_cited": true, "uncited_claims": []}')
    assert parsed == {"all_cited": True, "uncited_claims": []}


def test_parse_checker_output_fenced_json() -> None:
    raw = '```json\n{"all_cited": false, "uncited_claims": ["X"]}\n```'
    parsed = _parse_checker_output(raw)
    assert parsed == {"all_cited": False, "uncited_claims": ["X"]}


def test_parse_checker_output_embedded_json() -> None:
    raw = 'Verdict follows: {"all_cited": true, "uncited_claims": []} thanks!'
    parsed = _parse_checker_output(raw)
    assert parsed is not None
    assert parsed["all_cited"] is True


def test_parse_checker_output_returns_none_for_garbage() -> None:
    assert _parse_checker_output("this is not json") is None
    assert _parse_checker_output("") is None


# ---------------------------------------------------------------------------
# must_cite_per_claim guardrail tests (mocking the checker Runner.run)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@patch(
    "workspace_operator.guardrails.must_cite_per_claim.Runner.run",
    new_callable=AsyncMock,
)
async def test_must_cite_per_claim_passes_when_checker_says_all_cited(
    mock_runner_run: AsyncMock,
) -> None:
    mock_runner_run.return_value = SimpleNamespace(
        final_output=json.dumps({"all_cited": True, "uncited_claims": []}),
    )
    tripped, info = await _invoke_per_claim(
        "Per [[note-abc]], the team shipped on Monday."
    )
    assert tripped is False
    assert info["reason"] == "ok"


@pytest.mark.asyncio
@patch(
    "workspace_operator.guardrails.must_cite_per_claim.Runner.run",
    new_callable=AsyncMock,
)
async def test_must_cite_per_claim_trips_when_checker_says_uncited(
    mock_runner_run: AsyncMock,
) -> None:
    mock_runner_run.return_value = SimpleNamespace(
        final_output=json.dumps(
            {
                "all_cited": False,
                "uncited_claims": ["The team shipped on Monday."],
            }
        ),
    )
    tripped, info = await _invoke_per_claim(
        "The team shipped on Monday. Some other framing."
    )
    assert tripped is True
    assert info["reason"] == "uncited_claims"
    assert info["uncited_claims"] == ["The team shipped on Monday."]


@pytest.mark.asyncio
@patch(
    "workspace_operator.guardrails.must_cite_per_claim.Runner.run",
    new_callable=AsyncMock,
)
async def test_must_cite_per_claim_passes_on_malformed_checker_output(
    mock_runner_run: AsyncMock,
) -> None:
    """A wedge in the checker model must NOT silently fail otherwise-good runs."""
    mock_runner_run.return_value = SimpleNamespace(
        final_output="this is not json at all",
    )
    tripped, info = await _invoke_per_claim(
        "Per [[note-abc]], the team shipped on Monday."
    )
    assert tripped is False
    assert info["reason"] == "unparseable_checker_output"


@pytest.mark.asyncio
@patch(
    "workspace_operator.guardrails.must_cite_per_claim.Runner.run",
    new_callable=AsyncMock,
)
async def test_must_cite_per_claim_passes_on_checker_exception(
    mock_runner_run: AsyncMock,
) -> None:
    """An exception inside the checker must default to passing."""
    mock_runner_run.side_effect = RuntimeError("OpenAI 503")
    tripped, info = await _invoke_per_claim(
        "Per [[note-abc]], the team shipped on Monday."
    )
    assert tripped is False
    assert info["reason"] == "checker_error"
    assert "OpenAI 503" in info["error"]


@pytest.mark.asyncio
async def test_must_cite_per_claim_passes_on_empty_output() -> None:
    """Empty output should never trip — there are no claims to cite."""
    tripped, info = await _invoke_per_claim("")
    assert tripped is False
    assert info["reason"] == "empty_output"


@pytest.mark.asyncio
@patch(
    "workspace_operator.guardrails.must_cite_per_claim.Runner.run",
    new_callable=AsyncMock,
)
async def test_must_cite_per_claim_defaults_to_pass_when_all_cited_missing(
    mock_runner_run: AsyncMock,
) -> None:
    """`all_cited` missing from checker JSON → default to True (pass)."""
    mock_runner_run.return_value = SimpleNamespace(
        final_output=json.dumps({"uncited_claims": []}),
    )
    tripped, _info = await _invoke_per_claim("Some output text.")
    assert tripped is False


# ---------------------------------------------------------------------------
# max_tool_calls helper tests
# ---------------------------------------------------------------------------


def test_derive_max_turns_uses_settings_max_tool_calls() -> None:
    s = Settings(
        poggle_base_url="https://x",
        shared_secret="s" * 40,
        openai_api_key="sk-test",
        model="gpt-4.1-mini",
        request_timeout_s=30.0,
        max_tool_calls=12,
    )
    assert derive_max_turns(s) == 12


def test_derive_max_turns_floor_is_one() -> None:
    s = Settings(
        poggle_base_url="https://x",
        shared_secret="s" * 40,
        openai_api_key="sk-test",
        model="gpt-4.1-mini",
        request_timeout_s=30.0,
        max_tool_calls=0,
    )
    assert derive_max_turns(s) == 1


def test_check_tool_call_budget_passes_under_limit() -> None:
    ctx = SimpleNamespace(tool_calls=5)
    # Should not raise
    check_tool_call_budget(ctx, _SETTINGS)


def test_check_tool_call_budget_raises_at_limit() -> None:
    ctx = SimpleNamespace(tool_calls=20)  # equals max_tool_calls
    with pytest.raises(ToolCallBudgetExceeded) as excinfo:
        check_tool_call_budget(ctx, _SETTINGS)
    assert excinfo.value.current == 20
    assert excinfo.value.limit == 20


def test_check_tool_call_budget_handles_missing_attr() -> None:
    """Tools may be wired before context is fully built — treat as zero."""
    ctx = SimpleNamespace()
    check_tool_call_budget(ctx, _SETTINGS)  # must not raise


# ---------------------------------------------------------------------------
# End-to-end: max_tool_calls flows through to Runner.run(max_turns=...)
#
# These tests stub _build_operator so they don't depend on tool-builder
# wiring (Agent 1's parallel scope). What we care about here is that the
# operator hands the right `max_turns` and guardrail-attached agent to
# the Runner — the actual tool surface is covered by other suites.
# ---------------------------------------------------------------------------


@patch("workspace_operator.operator._build_operator")
@patch("workspace_operator.operator._make_client")
@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_run_operator_passes_max_turns_to_runner(
    mock_runner_run: AsyncMock,
    mock_make_client: object,
    mock_build_operator: object,
) -> None:
    """`Settings.max_tool_calls` must reach `Runner.run` as `max_turns`."""
    from agents import Agent

    mock_runner_run.return_value = SimpleNamespace(
        final_output="Drafted a note citing [[note-1]].",
        new_items=[],
    )
    mock_client = AsyncMock()
    mock_client.draft_note = AsyncMock()
    mock_client.aclose = AsyncMock()
    mock_make_client.return_value = mock_client  # type: ignore[attr-defined]
    mock_build_operator.return_value = Agent(  # type: ignore[attr-defined]
        name="stub", instructions="stub", tools=[]
    )

    settings = Settings(
        poggle_base_url="https://poggle.test",
        shared_secret="s" * 40,
        openai_api_key="sk-test",
        model="gpt-4.1-mini",
        request_timeout_s=30.0,
        max_tool_calls=7,
    )
    payload = OperatorInput.model_validate(_BASE_PAYLOAD)

    await run_operator(payload, settings)

    assert mock_runner_run.called
    _args, kwargs = mock_runner_run.call_args
    assert kwargs["max_turns"] == 7


@patch("workspace_operator.operator._make_client")
@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_run_operator_must_cite_per_claim_propagates_to_builder(
    mock_runner_run: AsyncMock,
    mock_make_client: object,
) -> None:
    """When `must_cite_per_claim` is True the kwarg flows into _build_operator."""
    from agents import Agent

    mock_runner_run.return_value = SimpleNamespace(
        final_output="Drafted a note citing [[note-1]].",
        new_items=[],
    )
    mock_client = AsyncMock()
    mock_client.draft_note = AsyncMock()
    mock_client.aclose = AsyncMock()
    mock_make_client.return_value = mock_client  # type: ignore[attr-defined]

    with patch(
        "workspace_operator.operator._build_operator",
        return_value=Agent(name="stub", instructions="stub", tools=[]),
    ) as mock_build:
        payload = OperatorInput.model_validate(
            {**_BASE_PAYLOAD, "must_cite_per_claim": True}
        )
        await run_operator(payload, _SETTINGS)
        # The opt-in kwarg must be threaded through to the builder.
        assert mock_build.called
        _args, kwargs = mock_build.call_args
        assert kwargs.get("must_cite_per_claim") is True


@patch("workspace_operator.operator._make_client")
@patch("workspace_operator.operator.Runner.run", new_callable=AsyncMock)
async def test_run_operator_default_does_not_set_must_cite_per_claim(
    mock_runner_run: AsyncMock,
    mock_make_client: object,
) -> None:
    """Default OperatorInput: must_cite_per_claim=False reaches _build_operator."""
    from agents import Agent

    mock_runner_run.return_value = SimpleNamespace(
        final_output="Drafted a note citing [[note-1]].",
        new_items=[],
    )
    mock_client = AsyncMock()
    mock_client.draft_note = AsyncMock()
    mock_client.aclose = AsyncMock()
    mock_make_client.return_value = mock_client  # type: ignore[attr-defined]

    with patch(
        "workspace_operator.operator._build_operator",
        return_value=Agent(name="stub", instructions="stub", tools=[]),
    ) as mock_build:
        payload = OperatorInput.model_validate(_BASE_PAYLOAD)
        assert payload.must_cite_per_claim is False
        await run_operator(payload, _SETTINGS)
        _args, kwargs = mock_build.call_args
        assert kwargs.get("must_cite_per_claim") is False


def test_build_operator_attaches_only_lexical_by_default() -> None:
    """Direct unit test on _build_operator's guardrail wiring (no tools needed)."""
    from agents import Agent

    # Patch the tool builders so we don't depend on Agent 1's schemas.
    with patch("workspace_operator.operator.build_hybrid_search_tool"), patch(
        "workspace_operator.operator.build_read_note_tool"
    ), patch("workspace_operator.operator.build_web_fetch_tool"), patch(
        "workspace_operator.operator.build_draft_note_tool"
    ), patch("workspace_operator.operator.build_edit_note_tool"), patch(
        "workspace_operator.operator.build_link_notes_tool"
    ), patch("workspace_operator.operator.build_apply_template_tool"):
        from workspace_operator.operator import _build_operator

        agent = _build_operator(client=None, box_id="bx")  # type: ignore[arg-type]
        assert isinstance(agent, Agent)
        assert len(agent.output_guardrails) == 1


def test_build_operator_attaches_both_when_must_cite_per_claim() -> None:
    """Direct unit test that the per-claim guardrail is added when opted in."""
    from agents import Agent

    with patch("workspace_operator.operator.build_hybrid_search_tool"), patch(
        "workspace_operator.operator.build_read_note_tool"
    ), patch("workspace_operator.operator.build_web_fetch_tool"), patch(
        "workspace_operator.operator.build_draft_note_tool"
    ), patch("workspace_operator.operator.build_edit_note_tool"), patch(
        "workspace_operator.operator.build_link_notes_tool"
    ), patch("workspace_operator.operator.build_apply_template_tool"):
        from workspace_operator.operator import _build_operator

        agent = _build_operator(  # type: ignore[arg-type]
            client=None, box_id="bx", must_cite_per_claim=True
        )
        assert isinstance(agent, Agent)
        assert len(agent.output_guardrails) == 2
