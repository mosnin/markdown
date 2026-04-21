"""Typed payloads that cross the Next.js <-> Modal boundary."""

from __future__ import annotations

from pydantic import BaseModel, Field


class PlanStep(BaseModel):
    """A single step in the operator's execution plan."""

    index: int
    description: str
    tool: str  # "hybrid_search" | "draft_note" | "analysis"


class PlanResult(BaseModel):
    """Returned when mode='plan' — the agent's proposed plan."""

    run_id: str
    steps: list[PlanStep]
    summary: str


class OperatorInput(BaseModel):
    """Payload posted by `dispatchOperatorRun` in the Next.js service."""

    run_id: str = Field(min_length=8, max_length=128)
    user_id: str = Field(min_length=1)
    workspace_id: str = Field(min_length=1)
    branch_id: str = Field(min_length=1)
    box_id: str = Field(min_length=1)
    prompt: str = Field(min_length=1, max_length=4000)
    mode: str = Field(default="full")  # "plan" | "execute" | "full"
    approved_plan: list[PlanStep] | None = None
    # Phase 3 opt-in: when True, attach the model-based per-claim cite
    # guardrail in addition to the lexical one. The default (False)
    # preserves Phase 1/2 behaviour for callers that haven't migrated.
    must_cite_per_claim: bool = False
    # Wave 1 F — optional model override. When None, the operator falls back
    # to `Settings.model` (env-configured). The operator validates against
    # `ALLOWED_OPERATOR_MODELS` and raises a clear error before doing any
    # billable work if the value is unknown.
    model: str | None = None
    # Wave 1 F — per-run token budget. NULL/None means unlimited. Server-side
    # enforcement of tier-based defaults is a Wave 2 concern; the agent only
    # honours what the dispatcher passes in.
    max_input_tokens: int | None = None
    max_output_tokens: int | None = None

    # V3 harness additions.
    # ----------------------
    # When set, every write-capable tool call pauses for human approval
    # before executing. The agent POSTs to /api/agent/operator/approval/request
    # and polls for the verdict. See approval_gate.REQUIRES_APPROVAL_TOOLS.
    requires_approval: bool = False
    # When True, this run produces a plan document and waits for human
    # approval before executing. Short-circuits the "full" fast path.
    plan_first: bool = False
    # Optional persona slug (see public.agent_personas). When set, the
    # operator filters its tool list and overrides instructions per the
    # persona config fetched at run start.
    persona_slug: str | None = None
    # Optional per-run tool allowlist. When non-empty, only tools whose
    # name appears here are registered. Overrides persona allowlist.
    tool_allowlist: list[str] = Field(default_factory=list)


class OperatorResult(BaseModel):
    """Final response returned to the Next.js service."""

    run_id: str
    # Wave 1 F adds "cancelled" — set when the run was aborted because the
    # UI flipped `cancellation_requested_at`. The Next.js side maps it onto
    # the workspace_operator_runs.status enum verbatim.
    status: str  # "completed" | "failed" | "cancelled"
    notes_created: list[str] = Field(default_factory=list)
    tool_calls: int = 0
    error: str | None = None
    plan: PlanResult | None = None  # populated when mode="plan"

    # Phase 4 — token usage capture. These power per-workspace cost/quota
    # tracking (Agent A) and cache-hit-rate observability. `cached_input_tokens`
    # is the portion of `input_tokens` OpenAI billed at the cached rate; it is
    # a subset of input_tokens, not a separate category.
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    model: str | None = None


class SearchResult(BaseModel):
    note_id: str
    title: str
    snippet: str | None = None
    similarity: float | None = None
    keyword_score: float | None = None
    combined_score: float | None = None
    match_type: str | None = None


class DraftNoteResult(BaseModel):
    note_id: str
    title: str
    branch_id: str
    markdown_content: str = ""
