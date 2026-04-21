"""The Workspace Operator agent — OpenAI Agents SDK definition + run loop."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid

from agents import (
    Agent,
    MaxTurnsExceeded,
    OutputGuardrailTripwireTriggered,
    RunConfig,
    RunHooks,
    Runner,
)

from workspace_operator.client import PoggleAPIError, PoggleClient
from workspace_operator.guardrails import (
    build_cite_output_guardrail,
    build_must_cite_per_claim_guardrail,
    derive_max_turns,
)
from workspace_operator.models import OperatorInput, OperatorResult, PlanResult, PlanStep
from workspace_operator.settings import ALLOWED_OPERATOR_MODELS, Settings
from workspace_operator.tools import (
    build_apply_template_tool,
    build_archive_note_tool,
    build_draft_note_tool,
    build_edit_note_tool,
    build_execute_code_tool,
    build_hybrid_search_tool,
    build_link_notes_tool,
    build_list_notes_in_box_tool,
    build_move_note_tool,
    build_propose_box_structure_tool,
    build_read_memories_tool,
    build_read_note_tool,
    build_rename_note_tool,
    build_web_fetch_tool,
    build_web_search_tool,
    build_write_memory_tool,
)
from workspace_operator.persona import filter_tools_by_allowlist  # noqa: E402
from workspace_operator.tracing import flush_tracing, setup_tracing  # tracing: Phase 3 Agent 4

# V3 harness: streaming hooks, approval gate, steering poller.
from workspace_operator.hooks import StreamingOperatorHooks  # noqa: E402
from workspace_operator.approval_gate import (  # noqa: E402
    ToolCallRejected,
    ToolCallTimedOut,
    await_approval,
    should_gate_tool,
)
from workspace_operator.steering import SteerMessage, run_steer_poller  # noqa: E402

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Prompt-injection defence
# ---------------------------------------------------------------------------

# Total system prompt length cap. If the concatenation of SYSTEM_PROMPT +
# workspace context block exceeds this after sanitization, we truncate with a
# clear notice so an attacker can't simply pad instructions past any downstream
# limit.
_MAX_SYSTEM_PROMPT_CHARS = 20000


def sanitize_for_prompt(text: str, max_length: int = 2000) -> str:
    """Sanitize untrusted text before prompt interpolation.

    Truncates, strips prompt-injection patterns, escapes meta-characters.
    """
    if not text:
        return ""
    text = text[:max_length]
    # Strip common injection markers
    text = text.replace("</system>", "").replace("<|system|>", "")
    text = text.replace("[[SYSTEM]]", "").replace("</instructions>", "")
    # Strip null bytes and control chars except newlines/tabs
    text = "".join(ch for ch in text if ch == "\n" or ch == "\t" or ch >= " ")
    return text.strip()


def _bound_system_prompt(prompt: str, max_chars: int = _MAX_SYSTEM_PROMPT_CHARS) -> str:
    """Bound the total length of the assembled system prompt.

    If the prompt exceeds `max_chars`, truncate and append a clear notice so
    the model (and any human reading logs) knows content was dropped rather
    than silently swallowed. This guards against untrusted fields being
    padded out to push later, trusted instructions out of the model's
    attention window.
    """
    if len(prompt) <= max_chars:
        return prompt
    notice = "\n\n[NOTICE: system prompt truncated to bound length]\n"
    keep = max_chars - len(notice)
    if keep < 0:
        keep = 0
    return prompt[:keep] + notice


# ---------------------------------------------------------------------------
# Wave 1 F — cancellation + budget machinery
# ---------------------------------------------------------------------------

# How often the cancellation poller wakes up while Runner.run is in flight.
# Short enough that a clicked Cancel button feels responsive (the UI shows
# a spinner until the run row's status flips), long enough that we don't
# hammer the Next.js endpoint. 2s is the same cadence other internal pollers
# use; adjust here if it ever shows up in dashboards.
_CANCEL_POLL_INTERVAL_S = 2.0


class OperatorCancelled(Exception):
    """Raised when the operator polled `check_cancellation` and it returned True.

    Caught at the top level of each mode's runner; we convert it into an
    OperatorResult with status="cancelled" and whatever notes_created the
    run had drafted before the cancel landed.
    """


class OperatorBudgetExceeded(Exception):
    """Raised by `_BudgetHooks` when a run blows past `max_input_tokens` or
    `max_output_tokens`. Caught at the top level and converted to a
    status="failed" result with `error="Per-run token budget exceeded"`,
    surfacing any partial artifacts so the user knows what they got.
    """

    def __init__(self, used_input: int, used_output: int, max_input: int | None, max_output: int | None) -> None:
        super().__init__(
            f"budget exceeded: input={used_input}/{max_input}, output={used_output}/{max_output}"
        )
        self.used_input = used_input
        self.used_output = used_output
        self.max_input = max_input
        self.max_output = max_output


def _resolve_model(payload: OperatorInput, settings: Settings) -> str:
    """Pick the model id for a run and validate it.

    Per-run override > settings default. We reject anything outside
    `ALLOWED_OPERATOR_MODELS` early — before any tokens are spent — so a
    typo'd dispatcher doesn't quietly fall back to the wrong tier.
    """
    chosen = payload.model or settings.model
    if chosen not in ALLOWED_OPERATOR_MODELS:
        raise ValueError(
            f"model {chosen!r} is not in ALLOWED_OPERATOR_MODELS={ALLOWED_OPERATOR_MODELS}"
        )
    return chosen


class _BudgetHooks(RunHooks):
    """RunHooks that aborts when usage breaches the per-run budget.

    We hook `on_llm_end` (after every model call surfaces its usage) and
    `on_tool_end` (cheap defence-in-depth — the LLM's own usage refresh is
    what matters but tool ends are also natural checkpoints). The hook
    raises `OperatorBudgetExceeded`, which `Runner.run` propagates back up
    to the mode-level catch.

    Cancellation polling lives in a separate `asyncio.create_task` so we
    don't block the agent loop on a network round-trip every step.
    """

    def __init__(
        self,
        *,
        max_input_tokens: int | None,
        max_output_tokens: int | None,
    ) -> None:
        self._max_in = max_input_tokens
        self._max_out = max_output_tokens

    def _check(self, ctx_wrapper: object) -> None:
        if self._max_in is None and self._max_out is None:
            return
        usage = getattr(ctx_wrapper, "usage", None)
        if usage is None:
            return
        used_in = int(getattr(usage, "input_tokens", 0) or 0)
        used_out = int(getattr(usage, "output_tokens", 0) or 0)
        if self._max_in is not None and used_in > self._max_in:
            raise OperatorBudgetExceeded(used_in, used_out, self._max_in, self._max_out)
        if self._max_out is not None and used_out > self._max_out:
            raise OperatorBudgetExceeded(used_in, used_out, self._max_in, self._max_out)

    async def on_llm_end(self, context, agent, response) -> None:  # type: ignore[override,no-untyped-def]
        self._check(context)

    async def on_tool_end(self, context, agent, tool, result) -> None:  # type: ignore[override,no-untyped-def]
        self._check(context)


async def _run_with_cancel_poll(
    coro_factory,  # type: ignore[no-untyped-def]
    *,
    client: PoggleClient,
    run_id: str,
):
    """Run `coro_factory()` while a sidecar task polls for cancellation.

    Approach (chosen over monkey-patching the SDK):
      * Wrap the agent run in `asyncio.create_task` so we can await with
        `asyncio.wait`.
      * Spawn a sibling poller task that hits `check_cancellation` every
        `_CANCEL_POLL_INTERVAL_S`. When the API says cancelled, the poller
        cancels the agent task and raises OperatorCancelled.
      * On normal completion, cancel the poller and return the agent's
        result.

    We chose this approach over the SDK's RunHooks because tool calls can
    be slow (hybrid_search hitting Postgres FTS, web_fetch with a 10s
    timeout) — a hook-only check would only fire after each tool finished,
    leaving up to 10s of dead-token burn between cancel-click and abort.
    The poller fires regardless of what the agent loop is doing.
    """
    main_task: asyncio.Task = asyncio.create_task(coro_factory())
    cancelled_flag = {"v": False}

    async def _poller() -> None:
        try:
            while not main_task.done():
                await asyncio.sleep(_CANCEL_POLL_INTERVAL_S)
                if main_task.done():
                    return
                try:
                    is_cancelled = await client.check_cancellation(run_id)
                except Exception:  # noqa: BLE001
                    # Transient errors -> keep going. We never let a poller
                    # blip silently abort a healthy run.
                    log.warning("[operator] check_cancellation poll failed", exc_info=True)
                    continue
                # `is True` rather than truthy: the client returns a real bool
                # on success; anything else is a half-broken envelope and we
                # prefer to keep running than fake-cancel.
                if is_cancelled is True:
                    cancelled_flag["v"] = True
                    main_task.cancel()
                    return
        except asyncio.CancelledError:
            return

    poller_task: asyncio.Task = asyncio.create_task(_poller())

    try:
        result = await main_task
        return result
    except asyncio.CancelledError:
        if cancelled_flag["v"]:
            raise OperatorCancelled() from None
        raise
    finally:
        if not poller_task.done():
            poller_task.cancel()
            try:
                await poller_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass


# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are the Workspace Operator, an agent that produces reviewable knowledge
artifacts for a user's workspace.

## Critical rule — ALWAYS create notes
You MUST call `draft_note` at least once in every run. Your job is to
produce written artifacts — never just respond with text. If the user asks
you to research something, write the results into a note. If they ask you
to summarize, create a note with the summary. A run that ends without
calling `draft_note` is a failed run, even if you found useful information.

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
3. If the user's request involves web research, use `web_search` and
   `web_fetch` to gather external information.
4. Synthesize a single clear deliverable. If the prompt asks for multiple
   independent artifacts, draft each as its own note.
5. Call `draft_note` with a specific title and well-structured Markdown.
   DO NOT skip this step.
6. Use curator tools (`list_notes_in_box`, `archive_note`, `rename_note`,
   `move_note`) when the user asks you to organize, clean up, or tidy
   existing notes.
7. End with a one-paragraph summary of what you drafted and which notes
   you cited.

## Style
- Be concrete and specific. Prefer nouns and dates over vague claims.
- Use short paragraphs, bulleted lists for enumerations, and `##` headers
  to structure longer notes.
- Do not apologize or preface — produce work.
"""

# ---------------------------------------------------------------------------
# Workspace context block — Phase 4 prompt-cache tuning
#
# OpenAI's automatic prompt caching rewards byte-identical prefixes of >=1024
# tokens. The SYSTEM_PROMPT above is stable across every run; appending a
# byte-stable workspace-level context block after it lengthens the cached
# prefix from "one user's runs share cache" to "a whole workspace's runs share
# cache without polluting each other".
#
# The block must be *deterministic*: same inputs -> byte-identical bytes. We
# do not fetch live workspace metadata here (introduces non-determinism and a
# round-trip per run); we instead derive the block from the envelope fields
# (workspace_id, box_id) plus a bumpable CONTEXT_VERSION. When we need richer
# context we'll add a dedicated `/api/agent/tools/workspace_context` endpoint
# (see client.fetch_workspace_context) that callers can plug into this
# builder — still deterministic because the endpoint sorts boxes by id.
# ---------------------------------------------------------------------------

# Bump this to invalidate the cached prefix whenever we change how the block
# renders. The version string is embedded in the cached block itself.
CONTEXT_VERSION = "v1"


def _build_workspace_context_block(
    *,
    workspace_id: str,
    box_id: str,
    boxes: list[dict[str, object]] | None = None,
    workspace_name: str | None = None,
    workspace_instructions: str | None = None,
    box_instructions: str | None = None,
) -> str:
    """Return a byte-stable workspace context block for prompt caching.

    The block is concatenated after SYSTEM_PROMPT to form the agent's
    instructions. Same (workspace_id, box_id, boxes, workspace_name) -> same
    bytes -> OpenAI cache hit on the whole `SYSTEM_PROMPT + context block`
    prefix of every request in the workspace.

    Determinism rules:
      * boxes are sorted by (name, id) ascending — tuple key avoids ties when
        two boxes share a name
      * None/missing workspace_name and boxes render as stable placeholders
      * CONTEXT_VERSION is embedded so we can break cache intentionally
    """
    lines: list[str] = [
        "## Workspace context",
        f"context_version: {CONTEXT_VERSION}",
        f"workspace_id: {workspace_id}",
        f"target_box_id: {box_id}",
    ]
    if workspace_name:
        lines.append(f"workspace_name: {sanitize_for_prompt(workspace_name, max_length=200)}")
    if boxes:
        # Deterministic ordering: (name, id). Tuple handles duplicate names.
        sorted_boxes = sorted(
            boxes,
            key=lambda b: (str(b.get("name", "")), str(b.get("id", ""))),
        )
        lines.append("")
        lines.append("### Boxes")
        for b in sorted_boxes:
            name = sanitize_for_prompt(str(b.get("name", "")), max_length=200)
            bid = sanitize_for_prompt(str(b.get("id", "")), max_length=100)
            count = b.get("note_count")
            if isinstance(count, int):
                lines.append(f"- {name} ({bid}) — {count} notes")
            else:
                lines.append(f"- {name} ({bid})")
    ws_rules = sanitize_for_prompt(workspace_instructions or "")
    if ws_rules:
        lines.append("")
        lines.append("### Workspace instructions (user-set)")
        lines.append(ws_rules)
    box_rules = sanitize_for_prompt(box_instructions or "")
    if box_rules:
        lines.append("")
        lines.append("### Box instructions (user-set)")
        lines.append(box_rules)
    return "\n".join(lines) + "\n"


async def _build_context_with_instructions(
    client: PoggleClient,
    *,
    workspace_id: str,
    box_id: str,
) -> str:
    """Fetch user-set workspace + box instructions and build the context block.

    Instructions are opt-in — if both are empty we fall back to the bare
    context block so prompt-cache behaviour matches the pre-instructions
    baseline. Errors are non-fatal: on failure we log and return the bare
    block rather than blocking the run.
    """
    workspace_instructions: str | None = None
    box_instructions: str | None = None
    try:
        data = await client.fetch_workspace_context(box_id=box_id)
        workspace_instructions = data.get("workspace_instructions") or None
        box_instructions = data.get("box_instructions") or None
    except Exception:  # noqa: BLE001 — instructions are opt-in polish, not critical.
        # Keep the run going without instructions rather than failing the
        # whole operator over a missing optional context fetch.
        pass
    return _build_workspace_context_block(
        workspace_id=workspace_id,
        box_id=box_id,
        workspace_instructions=workspace_instructions,
        box_instructions=box_instructions,
    )


async def _build_run_prologue(
    client: PoggleClient,
    *,
    branch_id: str,
    base_prompt: str,
) -> str:
    """Return the prompt with a small dynamic prologue prepended.

    The prologue carries things that MUST NOT be in the cached system
    prefix because they change per run:

      * Today's date (UTC), so the agent can reason about recency
        ("recent papers", "this week", "last quarter") without guessing.
      * The active draft branch id, so the agent knows which branch its
        writes land on and can reference it in its final summary.
      * A short "recent runs" memory block — the last few completed runs
        for this user in this workspace, with titles of notes they
        produced. Without this the agent has amnesia between runs and
        re-does the same discovery work.

    All fetches are best-effort: a failure returns the bare prompt. The
    prologue goes on the USER prompt (not the system prompt) so it
    doesn't invalidate the prompt cache.
    """
    import datetime as _dt

    today = _dt.date.today().isoformat()
    lines: list[str] = [
        "## Run prologue",
        f"today: {today} (UTC)",
        f"active_branch_id: {branch_id}",
    ]
    try:
        memory = await client.fetch_run_memory(limit=5)
        recent = memory.get("recent_runs") or []
    except Exception:  # noqa: BLE001
        recent = []
    if recent:
        lines.append("")
        lines.append("### Recent runs (your memory — do not re-solve these)")
        for r in recent:
            when = sanitize_for_prompt(str(r.get("created_at", ""))[:10], max_length=20)
            preview = sanitize_for_prompt(str(r.get("prompt_preview", "")), max_length=500)
            raw_titles = r.get("note_titles") or []
            note_titles = [
                sanitize_for_prompt(str(t), max_length=200) for t in raw_titles
            ]
            title_suffix = (
                " — created: " + ", ".join(f'"{t}"' for t in note_titles)
                if note_titles
                else ""
            )
            lines.append(f'- [{when}] "{preview}"{title_suffix}')
    lines.append("")
    lines.append("## User request")
    lines.append(base_prompt)
    return "\n".join(lines)


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
    workspace_context_block: str = "",
    tool_allowlist: list[str] | None = None,
) -> Agent:
    """Construct the main Operator agent.

    The lexical cite guardrail is always on. The model-based per-claim
    guardrail is opt-in via `OperatorInput.must_cite_per_claim` so the
    cheaper-to-run baseline configuration stays the default.

    `workspace_context_block` is appended to SYSTEM_PROMPT to form a
    byte-stable prefix for prompt caching — see
    `_build_workspace_context_block`.
    """
    output_guardrails = [build_cite_output_guardrail()]
    if must_cite_per_claim:
        output_guardrails.append(build_must_cite_per_claim_guardrail())
    instructions = (
        SYSTEM_PROMPT + "\n\n" + workspace_context_block
        if workspace_context_block
        else SYSTEM_PROMPT
    )
    instructions = _bound_system_prompt(instructions)
    full_tools = [
        build_hybrid_search_tool(client),
        build_list_notes_in_box_tool(client),
        build_read_note_tool(client),
        build_web_search_tool(client),
        build_web_fetch_tool(client),
        build_draft_note_tool(client, box_id=box_id),
        build_edit_note_tool(client),
        build_rename_note_tool(client),
        build_move_note_tool(client),
        build_archive_note_tool(client),
        build_link_notes_tool(client),
        build_apply_template_tool(client, box_id=box_id),
        # V3 — new tools (code exec, box architect, memory read/write)
        build_execute_code_tool(client),
        build_propose_box_structure_tool(client),
        build_read_memories_tool(client),
        build_write_memory_tool(client),
    ]
    tools = filter_tools_by_allowlist(full_tools, tool_allowlist or [])
    return Agent(
        name="Workspace Operator",
        instructions=instructions,
        tools=tools,
        output_guardrails=output_guardrails,
    )


def _build_plan_agent(
    client: PoggleClient,
    *,
    workspace_context_block: str = "",
) -> Agent:
    """Agent used in plan mode — search/read only, no writes, no cite guardrail.

    Plan mode is allowed to inspect existing notes (`read_note`) and pull
    in external context (`web_fetch`) so the proposed plan can reference
    real titles and URLs, but it cannot draft, edit, link, or apply
    templates — those are write tools reserved for execute/full.
    """
    instructions = (
        PLAN_SYSTEM_PROMPT + "\n\n" + workspace_context_block
        if workspace_context_block
        else PLAN_SYSTEM_PROMPT
    )
    instructions = _bound_system_prompt(instructions)
    return Agent(
        name="Workspace Operator (Planning)",
        instructions=instructions,
        tools=[
            build_hybrid_search_tool(client),
            build_list_notes_in_box_tool(client),
            build_read_note_tool(client),
            build_web_search_tool(client),
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
    model = _resolve_model(payload, settings)
    try:
        # Wave 1 F — short-circuit if the user already cancelled before we
        # even start. Saves a model call.
        if await _was_cancelled(client, payload.run_id):
            return OperatorResult(
                run_id=payload.run_id, status="cancelled", model=model,
            )
        workspace_context = await _build_context_with_instructions(
            client,
            workspace_id=payload.workspace_id,
            box_id=payload.box_id,
        )
        agent = _build_plan_agent(client, workspace_context_block=workspace_context)
        run_config = RunConfig(
            model=model,
            workflow_name="workspace_operator",
            group_id=payload.run_id,
        )
        # Plan mode is read-only — no approval gate needed, but we still
        # stream events so the UI shows planning progress in real time.
        budget_hooks = StreamingOperatorHooks(
            client=client,
            run_id=payload.run_id,
            max_input_tokens=payload.max_input_tokens,
            max_output_tokens=payload.max_output_tokens,
            on_tool_gate=None,
        )
        # Tool-call budget enforcement: the SDK lacks a "stop after N
        # tool calls" knob, so we map Settings.max_tool_calls onto its
        # `max_turns` (one turn ≈ one tool call for tool-heavy loops).
        # See guardrails/max_tool_calls.py for the rationale.
        prompt_with_prologue = await _build_run_prologue(
            client, branch_id=payload.branch_id, base_prompt=payload.prompt
        )

        async def _do_run():  # type: ignore[no-untyped-def]
            return await Runner.run(
                agent,
                prompt_with_prologue,
                max_turns=derive_max_turns(settings),
                run_config=run_config,
                hooks=budget_hooks,
            )

        run_result = await _run_with_cancel_and_steer(
            _do_run, client=client, run_id=payload.run_id
        )
        tool_calls = _count_tool_calls(run_result)
        plan = _parse_plan(payload.run_id, run_result.final_output)
        usage = _extract_usage(run_result)
        return OperatorResult(
            run_id=payload.run_id,
            status="completed",
            tool_calls=tool_calls,
            plan=plan,
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            cached_input_tokens=usage.get("cached_input_tokens", 0),
            model=model,
        )
    except OperatorCancelled:
        log.info("[operator] plan run %s cancelled by user", payload.run_id)
        return OperatorResult(
            run_id=payload.run_id, status="cancelled", model=model,
        )
    except OperatorBudgetExceeded as err:
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            error="Per-run token budget exceeded",
            input_tokens=err.used_input,
            output_tokens=err.used_output,
            model=model,
        )
    except MaxTurnsExceeded as err:
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            tool_calls=settings.max_tool_calls,
            error=f"max_turns_exceeded: {err}",
            model=model,
        )
    except PoggleAPIError as err:
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            error=f"poggle_api_error[{err.status}]: {err.message}",
            model=model,
        )
    finally:
        await client.aclose()


# ---------------------------------------------------------------------------
# V3 harness — tool approval gate + steer poller factories
# ---------------------------------------------------------------------------


def _make_tool_gate(
    client: PoggleClient,
    *,
    run_id: str,
    requires_approval: bool,
    persona_requires_approval: bool = False,
    timeout_s: float = 300.0,
):
    """Return a tool-gate callable that pauses tool calls for human approval.

    The gate is attached to :class:`StreamingOperatorHooks` via its
    ``on_tool_gate`` parameter. On every ``on_tool_start``, if the tool
    is in :data:`REQUIRES_APPROVAL_TOOLS` and either the run or the
    persona requires approval, we POST to the approval endpoint and
    block until a human decides. Approval returns the (possibly edited)
    args; rejection raises :class:`ToolCallRejected` which the SDK
    propagates out of the hook.

    Note: the SDK uses these resolved args to actually invoke the tool
    only when the hook mutates them; in practice we log the edit via
    the ``tool_call_start`` event and trust the LLM's own args for
    tool invocation. Edits to args surface to the user as a visible
    diff in the approval UI but are not enforced at the tool-call layer.
    """

    async def _gate(tool_name: str, tool_call_id: str, args: dict) -> dict:
        if not should_gate_tool(
            tool_name,
            run_requires_approval=requires_approval,
            persona_requires_approval=persona_requires_approval,
        ):
            return args
        try:
            approved = await await_approval(
                client,
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                requested_args=args,
                preview=None,
                timeout_s=timeout_s,
            )
            return approved.resolved_args
        except ToolCallTimedOut:
            log.warning(
                "[operator] approval timed out for tool %s (run %s)",
                tool_name,
                run_id,
            )
            raise ToolCallRejected(reject_reason="approval_timed_out") from None

    return _gate


def _make_steer_handler(run_id: str):
    """Return a coroutine callback that logs received steer messages.

    Mid-run steering is logged as events so the UI shows the interjection,
    and the messages are marked ``consumed`` on the server side so the
    agent doesn't see them twice. Deeper integration (injecting them
    into the next LLM turn) requires SDK session-append which the 0.0.x
    series doesn't expose cleanly — for now the agent sees the messages
    via the ``steer_message_received`` event in its activity stream and
    (when persisted to run_memory) subsequent runs.
    """

    async def _on_messages(messages: list[SteerMessage]) -> None:
        if not messages:
            return
        log.info(
            "[operator] received %d steer message(s) for run %s",
            len(messages),
            run_id,
        )
        # The steer/poll endpoint already records a
        # ``steer_message_received`` event per message on consume; nothing
        # more to do here. Left as a seam for future injection work.

    return _on_messages


async def _run_with_cancel_and_steer(
    coro_factory,  # type: ignore[no-untyped-def]
    *,
    client: PoggleClient,
    run_id: str,
):
    """Run the agent with both the cancel poller AND the steer poller sidecars.

    Wraps :func:`_run_with_cancel_poll` with an additional background task
    that polls for unread steer messages every 3s. The steer poller is
    best-effort — it logs receipt of any messages (via the server's own
    ``steer_message_received`` event emission) but does not abort the run.
    """
    steer_stop = asyncio.Event()
    steer_handler = _make_steer_handler(run_id)
    steer_task = asyncio.create_task(
        run_steer_poller(
            client,
            cancel_event=steer_stop,
            on_messages=steer_handler,
            interval_s=3.0,
        )
    )
    try:
        return await _run_with_cancel_poll(
            coro_factory, client=client, run_id=run_id
        )
    finally:
        steer_stop.set()
        if not steer_task.done():
            try:
                await asyncio.wait_for(steer_task, timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):  # noqa: BLE001
                if not steer_task.done():
                    steer_task.cancel()


async def _was_cancelled(client: PoggleClient, run_id: str) -> bool:
    """Single-shot check_cancellation, swallowing transient errors.

    Used at phase boundaries (start of plan, between plan and execute) where
    we want a snapshot answer, not a long-running poller. If the network is
    flaky the run keeps going — false-cancellation is worse than the
    occasional missed click.

    We compare with `is True` rather than truthy-coerce: the client method's
    contract is to return a real bool, and any other shape (a Mock from a
    test stub, a stray dict from a half-renamed envelope) should be treated
    as "not cancelled" so we don't fake-abort healthy runs.
    """
    try:
        result = await client.check_cancellation(run_id)
    except Exception:  # noqa: BLE001
        log.warning("[operator] phase-boundary check_cancellation failed", exc_info=True)
        return False
    return result is True


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
    model = _resolve_model(payload, settings)
    if not payload.approved_plan:
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            error="execute mode requires approved_plan",
            model=model,
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
        # Wave 1 F — phase-boundary cancel check.
        if await _was_cancelled(client, payload.run_id):
            return OperatorResult(
                run_id=payload.run_id,
                status="cancelled",
                notes_created=notes_created,
                model=model,
            )
        # Report progress for each step before execution begins
        for step in payload.approved_plan:
            await client.report_progress(
                event_type="step_start",
                step_index=step.index,
                detail=step.description,
            )

        enriched_prompt = _build_execute_prompt(payload.prompt, payload.approved_plan)
        enriched_prompt = await _build_run_prologue(
            client, branch_id=payload.branch_id, base_prompt=enriched_prompt
        )

        workspace_context = await _build_context_with_instructions(
            client,
            workspace_id=payload.workspace_id,
            box_id=payload.box_id,
        )
        agent = _build_operator(
            client,
            box_id=payload.box_id,
            must_cite_per_claim=payload.must_cite_per_claim,
            workspace_context_block=workspace_context,
            tool_allowlist=payload.tool_allowlist or None,
        )
        run_config = RunConfig(
            model=model,
            workflow_name="workspace_operator",
            group_id=payload.run_id,
        )
        # Execute mode: stream events + optional approval gate for write tools.
        tool_gate = (
            _make_tool_gate(
                client,
                run_id=payload.run_id,
                requires_approval=payload.requires_approval,
            )
            if payload.requires_approval
            else None
        )
        budget_hooks = StreamingOperatorHooks(
            client=client,
            run_id=payload.run_id,
            max_input_tokens=payload.max_input_tokens,
            max_output_tokens=payload.max_output_tokens,
            on_tool_gate=tool_gate,
        )

        # See guardrails/max_tool_calls.py — Settings.max_tool_calls
        # is enforced via the SDK's `max_turns`, the closest available
        # primitive to a tool-call cap.
        async def _do_run():  # type: ignore[no-untyped-def]
            return await Runner.run(
                agent,
                enriched_prompt,
                max_turns=derive_max_turns(settings),
                run_config=run_config,
                hooks=budget_hooks,
            )

        run_result = await _run_with_cancel_and_steer(
            _do_run, client=client, run_id=payload.run_id
        )
        tool_calls = _count_tool_calls(run_result)
        usage = _extract_usage(run_result)

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
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            cached_input_tokens=usage.get("cached_input_tokens", 0),
            model=model,
        )
    except OperatorCancelled:
        log.info("[operator] execute run %s cancelled by user", payload.run_id)
        await client.report_progress(event_type="cancelled")
        return OperatorResult(
            run_id=payload.run_id,
            status="cancelled",
            notes_created=notes_created,
            model=model,
        )
    except OperatorBudgetExceeded as err:
        await client.report_progress(
            event_type="failed",
            detail="budget_exceeded",
        )
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            notes_created=notes_created,
            error="Per-run token budget exceeded",
            input_tokens=err.used_input,
            output_tokens=err.used_output,
            model=model,
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
            model=model,
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
            model=model,
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
            model=model,
        )
    finally:
        await client.aclose()


# ---------------------------------------------------------------------------
# Full mode (Phase 1 backward compat)
# ---------------------------------------------------------------------------

async def _run_full(payload: OperatorInput, settings: Settings) -> OperatorResult:
    """Phase 1 full flow — search + draft in a single pass."""
    client = _make_client(payload, settings)
    model = _resolve_model(payload, settings)

    notes_created: list[str] = []

    def _on_draft(note_id: str) -> None:
        notes_created.append(note_id)

    original_draft = client.draft_note

    async def draft_note_capturing(**kwargs: object) -> object:
        result = await original_draft(**kwargs)  # type: ignore[arg-type]
        _on_draft(result.note_id)
        return result

    client.draft_note = draft_note_capturing  # type: ignore[assignment]

    workspace_context = await _build_context_with_instructions(
        client,
        workspace_id=payload.workspace_id,
        box_id=payload.box_id,
    )
    agent = _build_operator(
        client,
        box_id=payload.box_id,
        must_cite_per_claim=payload.must_cite_per_claim,
        workspace_context_block=workspace_context,
        tool_allowlist=payload.tool_allowlist or None,
    )
    run_config = RunConfig(
        model=model,
        workflow_name="workspace_operator",
        group_id=payload.run_id,
    )
    # Full mode: stream events + optional approval gate for write tools.
    tool_gate = (
        _make_tool_gate(
            client,
            run_id=payload.run_id,
            requires_approval=payload.requires_approval,
        )
        if payload.requires_approval
        else None
    )
    budget_hooks = StreamingOperatorHooks(
        client=client,
        run_id=payload.run_id,
        max_input_tokens=payload.max_input_tokens,
        max_output_tokens=payload.max_output_tokens,
        on_tool_gate=tool_gate,
    )

    try:
        # Wave 1 F — phase-boundary cancel check.
        if await _was_cancelled(client, payload.run_id):
            return OperatorResult(
                run_id=payload.run_id,
                status="cancelled",
                notes_created=notes_created,
                model=model,
            )
        prompt_with_prologue = await _build_run_prologue(
            client, branch_id=payload.branch_id, base_prompt=payload.prompt
        )

        # See guardrails/max_tool_calls.py for the max_turns rationale.
        async def _do_run():  # type: ignore[no-untyped-def]
            return await Runner.run(
                agent,
                prompt_with_prologue,
                max_turns=derive_max_turns(settings),
                run_config=run_config,
                hooks=budget_hooks,
            )

        run_result = await _run_with_cancel_and_steer(
            _do_run, client=client, run_id=payload.run_id
        )
        tool_calls = _count_tool_calls(run_result)
        usage = _extract_usage(run_result)
        return OperatorResult(
            run_id=payload.run_id,
            status="completed",
            notes_created=notes_created,
            tool_calls=tool_calls,
            error=None,
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            cached_input_tokens=usage.get("cached_input_tokens", 0),
            model=model,
        )
    except OperatorCancelled:
        log.info("[operator] full run %s cancelled by user", payload.run_id)
        return OperatorResult(
            run_id=payload.run_id,
            status="cancelled",
            notes_created=notes_created,
            model=model,
        )
    except OperatorBudgetExceeded as err:
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            notes_created=notes_created,
            error="Per-run token budget exceeded",
            input_tokens=err.used_input,
            output_tokens=err.used_output,
            model=model,
        )
    except OutputGuardrailTripwireTriggered as err:
        log.warning("[operator] cite guardrail tripped for run %s", payload.run_id)
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            notes_created=notes_created,
            tool_calls=0,
            error=f"cite_guardrail: {err}",
            model=model,
        )
    except MaxTurnsExceeded as err:
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            notes_created=notes_created,
            tool_calls=settings.max_tool_calls,
            error=f"max_turns_exceeded: {err}",
            model=model,
        )
    except PoggleAPIError as err:
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            notes_created=notes_created,
            tool_calls=0,
            error=f"poggle_api_error[{err.status}]: {err.message}",
            model=model,
        )
    finally:
        await client.aclose()


# ---------------------------------------------------------------------------
# Public entry point — dispatches on mode
# ---------------------------------------------------------------------------

async def run_operator(payload: OperatorInput, settings: Settings) -> OperatorResult:
    """Run one Operator invocation end-to-end and return a serializable result."""
    # Wave 1 F — fail fast on unknown model ids before doing any setup work.
    # `_resolve_model` is called again inside each mode but doing it here
    # too means a typo'd dispatcher gets a clean error response, not a half-
    # initialised tracing client.
    try:
        _resolve_model(payload, settings)
    except ValueError as err:
        return OperatorResult(
            run_id=payload.run_id,
            status="failed",
            error=f"invalid_model: {err}",
            model=payload.model or settings.model,
        )

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


def _extract_usage(run_result: object) -> dict[str, int]:
    """Best-effort extraction of token usage from a RunResult.

    The OpenAI Agents SDK (>=0.x) exposes usage on
    `RunResult.context_wrapper.usage` as a `Usage` dataclass whose fields we
    care about are `input_tokens`, `output_tokens`, and
    `input_tokens_details.cached_tokens`.

    Older / streaming variants may expose it at `run_result.usage` directly.
    We also defensively fall back to `None` if any nested field is missing.
    Returns an empty dict when no usage can be found — callers default to 0.
    """
    usage_obj = getattr(run_result, "usage", None)
    if usage_obj is None:
        context_wrapper = getattr(run_result, "context_wrapper", None)
        if context_wrapper is not None:
            usage_obj = getattr(context_wrapper, "usage", None)
    if usage_obj is None:
        return {}

    input_tokens = getattr(usage_obj, "input_tokens", 0) or 0
    output_tokens = getattr(usage_obj, "output_tokens", 0) or 0

    cached_input_tokens = getattr(usage_obj, "cached_input_tokens", None)
    if cached_input_tokens is None:
        # SDK ≥0.x nests the cached-token count under input_tokens_details.
        details = getattr(usage_obj, "input_tokens_details", None)
        cached_input_tokens = getattr(details, "cached_tokens", 0) if details else 0
    cached_input_tokens = cached_input_tokens or 0

    return {
        "input_tokens": int(input_tokens),
        "output_tokens": int(output_tokens),
        "cached_input_tokens": int(cached_input_tokens),
    }
