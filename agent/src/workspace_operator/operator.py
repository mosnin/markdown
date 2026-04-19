"""The Workspace Operator agent — OpenAI Agents SDK definition + run loop."""

from __future__ import annotations

import logging

from agents import (
    Agent,
    MaxTurnsExceeded,
    OutputGuardrailTripwireTriggered,
    RunConfig,
    Runner,
)

from workspace_operator.client import PoggleAPIError, PoggleClient
from workspace_operator.guardrails import build_cite_output_guardrail
from workspace_operator.models import OperatorInput, OperatorResult
from workspace_operator.settings import Settings
from workspace_operator.tools import build_draft_note_tool, build_hybrid_search_tool

log = logging.getLogger(__name__)


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


def _build_operator(client: PoggleClient, *, box_id: str) -> Agent:
    return Agent(
        name="Workspace Operator",
        instructions=SYSTEM_PROMPT,
        tools=[
            build_hybrid_search_tool(client),
            build_draft_note_tool(client, box_id=box_id),
        ],
        output_guardrails=[build_cite_output_guardrail()],
    )


async def run_operator(payload: OperatorInput, settings: Settings) -> OperatorResult:
    """Run one Operator invocation end-to-end and return a serializable result."""
    client = PoggleClient(
        base_url=settings.poggle_base_url,
        shared_secret=settings.shared_secret,
        user_id=payload.user_id,
        workspace_id=payload.workspace_id,
        branch_id=payload.branch_id,
        run_id=payload.run_id,
        timeout_s=settings.request_timeout_s,
    )

    notes_created: list[str] = []

    def _on_draft(note_id: str) -> None:
        notes_created.append(note_id)

    # Wrap the draft client method so we can capture note ids as they're
    # created, rather than trying to mine them out of the agent's final
    # textual output. Keeps the Operator decoupled from accounting logic.
    original_draft = client.draft_note

    async def draft_note_capturing(**kwargs: object) -> object:
        result = await original_draft(**kwargs)  # type: ignore[arg-type]
        _on_draft(result.note_id)
        return result

    client.draft_note = draft_note_capturing  # type: ignore[assignment]

    agent = _build_operator(client, box_id=payload.box_id)
    run_config = RunConfig(
        model=settings.model,
        workflow_name="workspace_operator",
        group_id=payload.run_id,
    )

    try:
        run_result = await Runner.run(
            agent,
            payload.prompt,
            max_turns=settings.max_tool_calls,
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


def _count_tool_calls(run_result: object) -> int:
    """Best-effort introspection of tool call count across SDK versions."""
    new_items = getattr(run_result, "new_items", None)
    if not new_items:
        return 0
    return sum(1 for item in new_items if getattr(item, "type", None) == "tool_call_item")
