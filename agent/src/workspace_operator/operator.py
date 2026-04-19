"""The Workspace Operator agent — OpenAI Agents SDK definition + run loop."""

from __future__ import annotations

import json
import logging

from agents import (
    Agent,
    MaxTurnsExceeded,
    OutputGuardrailTripwireTriggered,
    RunConfig,
    Runner,
)

from workspace_operator.client import PoggleAPIError, PoggleClient
from workspace_operator.guardrails import (
    build_cite_output_guardrail,
    build_must_cite_per_claim_guardrail,
    derive_max_turns,
)
from workspace_operator.models import OperatorInput, OperatorResult, PlanResult, PlanStep
from workspace_operator.settings import Settings
from workspace_operator.tools import (
    build_apply_template_tool,
    build_draft_note_tool,
    build_edit_note_tool,
    build_hybrid_search_tool,
    build_link_notes_tool,
    build_read_note_tool,
    build_web_fetch_tool,
)
from workspace_operator.tracing import flush_tracing, setup_tracing  # tracing: Phase 3 Agent 4

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are the Workspace Operator, an agent that produces reviewable knowledge
artifacts for a user's workspace.

## Your output model
- Every run terminates in one or more drafted notes on a *draft branch*,
  not on main. The user will review your output as a diff.
- You MUST cite every factual claim with a `[[note_id]]` wikilink pointing
  to a note returned by `hybrid_search`. Uncited claims cause the run to
  fail the cite guardrail.
- If a request cannot be satisfied from workspace context alone, say so
  in the drafted note and flag the gap — do not fabricate.

## How to work
1. Read the user's prompt carefully.
2. Call `hybrid_search` one or more times to gather relevant notes. Bias
   toward more searches with specific queries over one broad search.
3. Synthesize a single clear deliverable. If the prompt asks for multiple
   independent artifacts, draft each as its own note.
4. Call `draft_note` with a specific title and well-structured Markdown.
5. End with a one-paragraph summary of what you drafted and which notes
   you cited.

## Style
- Be concrete and specific. Prefer nouns and dates over vague claims.
- Use short paragraphs, bulleted lists for enumerations, and `##` headers
  to structure longer notes.
- Do not apologize or preface — produce work.
"""

PLAN_SYSTEM_PROMPT = """\
You are the Workspace Operator in planning mode. Your job is to analyze the
user's request and produce a structured execution plan.

## Instructions
1. Use `hybrid_search` to understand what relevant content exists in the workspace.
2. Based on what you find, produce a plan with 3-7 concrete steps.
3. Each step should specify what tool will be used and what it will accomplish.
4. Do NOT draft any notes — only search and plan.

## Output format
Respond with a JSON object:
{
  "steps": [
    {"index": 0, "description": "Search for competitive analysis notes", "tool": "hybrid_search"},
    {"index": 1, "description": "Search for product roadmap context", "tool": "hybrid_search"},
    {"index": 2, "description": "Draft competitive brief synthesizing findings", "tool": "draft_note"}
  ],
  "summary": "I'll search for competitive and roadmap context, then draft a synthesis brief."
}
"""


# ---------------------------------------------------------------------------
# Agent builders
# ---------------------------------------------------------------------------

def _build_operator(
    client: PoggleClient,
    *,
    box_id: str,
    must_cite_per_claim: bool = False,
) -> Agent:
    """Construct the main Operator agent.

    The lexical cite guardrail is always on. The model-based per-claim
    guardrail is opt-in via `OperatorInput.must_cite_per_claim` so the
    cheaper-to-run baseline configuration stays the default.
    """
    output_guardrails = [build_cite_output_guardrail()]
    if must_cite_per_claim:
        output_guardrails.append(build_must_cite_per_claim_guardrail())
    return Agent(
        name="Workspace Operator",
        instructions=SYSTEM_PROMPT,
        tools=[
            build_hybrid_search_tool(client),
            build_read_note_tool(client),
            build_web_fetch_tool(client),
            build_draft_note_tool(client, box_id=box_id),
            build_edit_note_tool(client),
            build_link_notes_tool(client),
            build_apply_template_tool(client, box_id=box_id),
        ],
        output_guardrails=output_guardrails,
    )


def _build_plan_agent(client: PoggleClient) -> Agent:
    """Agent used in plan mode — search/read only, no writes, no cite guardrail.

    Plan mode is allowed to inspect existing notes (`read_note`) and pull
    in external context (`web_fetch`) so the proposed plan can reference
    real titles and URLs, but it cannot draft, edit, link, or apply
    templates — those are write tools reserved for execute/full.
    """
    return Agent(
        name="Workspace Operator (Planning)",
        instructions=PLAN_SYSTEM_PROMPT,
        tools=[
            build_hybrid_search_tool(client),
            build_read_note_tool(client),
            build_web_fetch_tool(client),
        ],
    )


def _build_execute_prompt(original_prompt: str, plan: list[PlanStep]) -> str:
    """Inject the approved plan into the agent's prompt."""
    steps_text = "\n".join(f"  {s.index + 1}. [{s.tool}] {s.description}" for s in plan)
    return f"""{original_prompt}

## Approved execution plan
Follow these steps in order:
{steps_text}

Execute each step carefully. After completing all steps, summarize what you created."""


# ---------------------------------------------------------------------------
# Client factory (shared across modes)
# ---------------------------------------------------------------------------

def _make_client(payload: OperatorInput, settings: Settings) -> PoggleClient:
    return PoggleClient(
        base_url=settings.poggle_base_url,
        shared_secret=settings.shared_secret,
        user_id=payload.user_id,
        workspace_id=payload.workspace_id,
        branch_id=payload.branch_id,
        run_id=payload.run_id,
        timeout_s=settings.request_timeout_s,
    )


# ---------------------------------------------------------------------------
# Plan mode
# ---------------------------------------------------------------------------

async def _run_plan(payload: OperatorInput, settings: Settings) -> OperatorResult:
    """Run the planning agent and return a structured PlanResult."""
    client = _make_client(payload, settings)
    try:
        agent = _build_plan_agent(client)
        run_config = RunConfig(
            model=settings.model,
            workflow_name="workspace_operator",
            group_id=payload.run_id,
        )
        # Tool-call budget enforcement: the SDK lacks a "stop after N
        # tool calls" knob, so we map Settings.max_tool_calls onto its
        # `max_turns` (one turn ≈ one tool call for tool-heavy loops).
        # See guardrails/max_tool_calls.py for the rationale.
        run_result = await Runner.run(
            agent,
            payload.prompt,
            max_turns=derive_max_turns(settings),
            run_config=run_config,
        )
        tool_calls = _count_tool_calls(run_result)
        plan = _parse_plan(payload.run_id, run_result.final_output)
        return OperatorResult(
            run_id=payload.run_id,
            status="completed",
            tool_calls=tool_calls,
            plan=plan,
        )
    except MaxTurnsExceeded as err:
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            tool_calls=settings.max_tool_calls,
            error=f"max_turns_exceeded: {err}",
        )
    except PoggleAPIError as err:
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            error=f"poggle_api_error[{err.status}]: {err.message}",
        )
    finally:
        await client.aclose()


def _parse_plan(run_id: str, raw_output: str) -> PlanResult:
    """Extract a PlanResult from the planning agent's JSON output.

    The agent is prompted to return JSON, but may include markdown fences or
    extra prose around it. We attempt to extract the first valid JSON object.
    """
    try:
        data = json.loads(raw_output)
    except json.JSONDecodeError:
        # Try to extract a JSON object from fenced code blocks or inline JSON
        data = _extract_json_object(raw_output)

    if data is None:
        raise ValueError(f"Could not parse plan JSON from agent output: {raw_output[:200]}")

    steps = [PlanStep.model_validate(s) for s in data.get("steps", [])]
    summary = data.get("summary", "")
    return PlanResult(run_id=run_id, steps=steps, summary=summary)


def _extract_json_object(text: str) -> dict | None:
    """Best-effort extraction of the first JSON object from free-form text."""
    # Try stripping markdown code fences first
    import re

    fenced = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            pass

    # Brute-force: find first '{' and try parsing from there
    start = text.find("{")
    if start == -1:
        return None
    for end in range(len(text), start, -1):
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            continue
    return None


# ---------------------------------------------------------------------------
# Execute mode
# ---------------------------------------------------------------------------

async def _run_execute(payload: OperatorInput, settings: Settings) -> OperatorResult:
    """Execute an approved plan with progress reporting."""
    if not payload.approved_plan:
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            error="execute mode requires approved_plan",
        )

    client = _make_client(payload, settings)
    notes_created: list[str] = []

    def _on_draft(note_id: str) -> None:
        notes_created.append(note_id)

    original_draft = client.draft_note

    async def draft_note_capturing(**kwargs: object) -> object:
        result = await original_draft(**kwargs)  # type: ignore[arg-type]
        _on_draft(result.note_id)
        await client.report_progress(
            event_type="note_drafted",
            detail=f"Drafted note: {result.title}",
        )
        return result

    client.draft_note = draft_note_capturing  # type: ignore[assignment]

    try:
        # Report progress for each step before execution begins
        for step in payload.approved_plan:
            await client.report_progress(
                event_type="step_start",
                step_index=step.index,
                detail=step.description,
            )

        enriched_prompt = _build_execute_prompt(payload.prompt, payload.approved_plan)

        agent = _build_operator(
            client,
            box_id=payload.box_id,
            must_cite_per_claim=payload.must_cite_per_claim,
        )
        run_config = RunConfig(
            model=settings.model,
            workflow_name="workspace_operator",
            group_id=payload.run_id,
        )

        # See guardrails/max_tool_calls.py — Settings.max_tool_calls
        # is enforced via the SDK's `max_turns`, the closest available
        # primitive to a tool-call cap.
        run_result = await Runner.run(
            agent,
            enriched_prompt,
            max_turns=derive_max_turns(settings),
            run_config=run_config,
        )
        tool_calls = _count_tool_calls(run_result)

        # Report all steps complete
        for step in payload.approved_plan:
            await client.report_progress(
                event_type="step_complete",
                step_index=step.index,
                detail=step.description,
            )

        await client.report_progress(event_type="completed")

        return OperatorResult(
            run_id=payload.run_id,
            status="completed",
            notes_created=notes_created,
            tool_calls=tool_calls,
        )
    except OutputGuardrailTripwireTriggered as err:
        log.warning("[operator] cite guardrail tripped for run %s", payload.run_id)
        await client.report_progress(
            event_type="failed",
            detail=f"cite_guardrail: {err}",
        )
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            notes_created=notes_created,
            error=f"cite_guardrail: {err}",
        )
    except MaxTurnsExceeded as err:
        await client.report_progress(
            event_type="failed",
            detail=f"max_turns_exceeded: {err}",
        )
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            notes_created=notes_created,
            tool_calls=settings.max_tool_calls,
            error=f"max_turns_exceeded: {err}",
        )
    except PoggleAPIError as err:
        await client.report_progress(
            event_type="failed",
            detail=f"poggle_api_error[{err.status}]: {err.message}",
        )
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            notes_created=notes_created,
            error=f"poggle_api_error[{err.status}]: {err.message}",
        )
    finally:
        await client.aclose()


# ---------------------------------------------------------------------------
# Full mode (Phase 1 backward compat)
# ---------------------------------------------------------------------------

async def _run_full(payload: OperatorInput, settings: Settings) -> OperatorResult:
    """Phase 1 full flow — search + draft in a single pass."""
    client = _make_client(payload, settings)

    notes_created: list[str] = []

    def _on_draft(note_id: str) -> None:
        notes_created.append(note_id)

    original_draft = client.draft_note

    async def draft_note_capturing(**kwargs: object) -> object:
        result = await original_draft(**kwargs)  # type: ignore[arg-type]
        _on_draft(result.note_id)
        return result

    client.draft_note = draft_note_capturing  # type: ignore[assignment]

    agent = _build_operator(
        client,
        box_id=payload.box_id,
        must_cite_per_claim=payload.must_cite_per_claim,
    )
    run_config = RunConfig(
        model=settings.model,
        workflow_name="workspace_operator",
        group_id=payload.run_id,
    )

    try:
        # See guardrails/max_tool_calls.py for the max_turns rationale.
        run_result = await Runner.run(
            agent,
            payload.prompt,
            max_turns=derive_max_turns(settings),
            run_config=run_config,
        )
        tool_calls = _count_tool_calls(run_result)
        return OperatorResult(
            run_id=payload.run_id,
            status="completed",
            notes_created=notes_created,
            tool_calls=tool_calls,
            error=None,
        )
    except OutputGuardrailTripwireTriggered as err:
        log.warning("[operator] cite guardrail tripped for run %s", payload.run_id)
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            notes_created=notes_created,
            tool_calls=0,
            error=f"cite_guardrail: {err}",
        )
    except MaxTurnsExceeded as err:
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            notes_created=notes_created,
            tool_calls=settings.max_tool_calls,
            error=f"max_turns_exceeded: {err}",
        )
    except PoggleAPIError as err:
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            notes_created=notes_created,
            tool_calls=0,
            error=f"poggle_api_error[{err.status}]: {err.message}",
        )
    finally:
        await client.aclose()


# ---------------------------------------------------------------------------
# Public entry point — dispatches on mode
# ---------------------------------------------------------------------------

async def run_operator(payload: OperatorInput, settings: Settings) -> OperatorResult:
    """Run one Operator invocation end-to-end and return a serializable result."""
    # tracing: Phase 3 Agent 4 — pipe Agents-SDK spans into Poggle's activity feed.
    tracing_client = _make_client(payload, settings)
    tracing_handle = setup_tracing(tracing_client, payload.run_id)
    try:
        if payload.mode == "plan":
            return await _run_plan(payload, settings)
        elif payload.mode == "execute":
            return await _run_execute(payload, settings)
        else:
            # "full" mode — Phase 1 backward compat
            return await _run_full(payload, settings)
    finally:
        # tracing: Phase 3 Agent 4 — flush + deregister processor before returning.
        try:
            await flush_tracing(tracing_handle)
        finally:
            await tracing_client.aclose()


def _count_tool_calls(run_result: object) -> int:
    """Best-effort introspection of tool call count across SDK versions."""
    new_items = getattr(run_result, "new_items", None)
    if not new_items:
        return 0
    return sum(1 for item in new_items if getattr(item, "type", None) == "tool_call_item")
