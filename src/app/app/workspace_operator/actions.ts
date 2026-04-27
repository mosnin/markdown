"use server";

import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import { createDraftBranch } from "@/server/services/branch_service";
import {
  dispatchOperatorRun,
  dispatchOperatorPlan,
  dispatchOperatorExecute,
  cancelOperatorRun,
  retryOperatorRun,
  type OperatorRunResult,
  type OperatorPlanResult,
} from "@/server/services/workspace_operator_service";
import {
  createOperatorRun,
  updateOperatorRun,
} from "@/server/services/workspace_operator_runs_service";
import { recordOperatorUsage } from "@/server/services/workspace_operator_usage_service";
import {
  checkOperatorQuota,
  type OperatorQuota,
} from "@/server/services/workspace_operator_quota_service";
import {
  listOperatorPrompts,
  createOperatorPrompt,
} from "@/server/services/operator_prompts_service";
import {
  notifyRunCompleted,
  notifyRunFailed,
  notifyRunAwaitingApproval,
  notifyRunCancelled,
} from "@/server/services/operator_notifications_service";
import type { WorkspacePlan } from "@/server/services/subscription_service";
import type {
  OperatorPlanStep,
  EditedOperatorPlanStep,
  OperatorModel,
  SavedOperatorPrompt,
} from "./types";
import { OPERATOR_MODELS, DEFAULT_OPERATOR_MODEL } from "./types";
import { isWorkspaceOperatorEnabled } from "@/lib/env";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Structured error body returned when a run is denied by the per-tier
 * Operator quota. The Operator panel uses the `code === "quota_exceeded"`
 * discriminator to swap into its quota-exceeded phase and render the
 * resetsAt / upgrade-plan CTA.
 */
export interface ActionErrorQuotaExceeded {
  code: "quota_exceeded";
  message: string;
  tier: WorkspacePlan;
  limit: number | null;
  used: number;
  /** ISO string — safe to JSON-serialize back to the client. */
  resetsAt: string;
}

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }
  | { ok: false; error: ActionErrorQuotaExceeded };

function quotaErrorResult(quota: OperatorQuota): {
  ok: false;
  error: ActionErrorQuotaExceeded;
} {
  const label =
    quota.tier === "business"
      ? "Business"
      : quota.tier === "pro"
        ? "Pro"
        : "Free";
  return {
    ok: false,
    error: {
      code: "quota_exceeded",
      message: `You've used all ${quota.limit ?? "\u221e"} Operator runs on the ${label} tier this month.`,
      tier: quota.tier,
      limit: quota.limit,
      used: quota.used,
      resetsAt: quota.resetsAt.toISOString(),
    },
  };
}

/**
 * Admin users (set via ADMIN_EMAILS) bypass the quota check entirely —
 * they already bypass every other product surface and are the people
 * most likely to be diagnosing a quota regression. Matches the same
 * source-of-truth list used by `requireAdmin` so the two never drift.
 */
function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/**
 * Run the quota check unless the caller is an admin. Returns the quota
 * object (for optional logging) or a structured error result ready to
 * bubble back to the client.
 */
async function gateOnQuota(
  supabase: SupabaseClient,
  user: Pick<User, "id" | "email">,
  workspaceId: string
): Promise<
  | { ok: true; quota: OperatorQuota | null }
  | { ok: false; error: ActionErrorQuotaExceeded }
> {
  if (isAdminEmail(user.email ?? null)) {
    return { ok: true, quota: null };
  }
  const quota = await checkOperatorQuota(supabase, {
    userId: user.id,
    workspaceId,
  });
  if (!quota.allowed) {
    return quotaErrorResult(quota);
  }
  return { ok: true, quota };
}

export interface RunWorkspaceOperatorInput {
  prompt: string;
  /** Box the agent may draft notes into. Required in v1. */
  boxId: string;
  /** Optional human-friendly branch name. Defaults to an agent-slug. */
  branchName?: string;
  /**
   * Operator model to use. Defaults to the cheapest tier-allowed model.
   * Accepts arbitrary strings so server callers (e.g. retry, REST API) can
   * forward an unvalidated model id from a stored row; `resolveModel`
   * narrows to the allowed set at the boundary.
   */
  model?: OperatorModel | string;
  /** Optional per-run input-token cap forwarded to the agent. */
  maxInputTokens?: number | null;
  /** Optional per-run output-token cap forwarded to the agent. */
  maxOutputTokens?: number | null;
  /** Session to associate this run with. (Phase 12) */
  sessionId?: string | null;
}

/**
 * Validate / normalise a model id passed across the action boundary.
 * Returns the supplied id when allowed, otherwise the cheap default.
 * Tier gating is enforced separately in the panel UI; this is the
 * server-side last-mile guard that prevents an arbitrary string from
 * reaching the Modal endpoint.
 */
function resolveModel(
  candidate: string | null | undefined
): OperatorModel {
  if (!candidate) return DEFAULT_OPERATOR_MODEL;
  return (OPERATOR_MODELS as readonly string[]).includes(candidate)
    ? (candidate as OperatorModel)
    : DEFAULT_OPERATOR_MODEL;
}

export interface RunWorkspaceOperatorOutput {
  run_id: string;
  branch_id: string;
  status: OperatorRunResult["status"];
  notes_created: string[];
  tool_calls: number;
  error?: string | null;
}

/**
 * Kick off a Workspace Operator run.
 *
 * Phase 1 flow:
 *   1. Auth + feature flag check
 *   2. Create a fresh draft branch scoped to the current user
 *   3. POST to the Modal endpoint with a signed envelope
 *   4. Record an audit event on completion
 *   5. Return the run result (note IDs created on the branch, tool calls)
 *
 * UI then navigates the user to the diff view for the branch.
 */
export async function runWorkspaceOperatorAction(
  input: RunWorkspaceOperatorInput
): Promise<ActionResult<RunWorkspaceOperatorOutput>> {
  try {
    if (!isWorkspaceOperatorEnabled()) {
      return {
        ok: false,
        error: "Workspace Operator is not enabled for this deployment.",
      };
    }

    const prompt = input.prompt?.trim();
    if (!prompt) {
      return { ok: false, error: "Prompt is required." };
    }
    if (prompt.length > 4000) {
      return { ok: false, error: "Prompt must be 4000 characters or fewer." };
    }
    if (!input.boxId?.trim()) {
      return { ok: false, error: "boxId is required." };
    }

    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();

    // Verify the target box belongs to this workspace — the agent layer
    // re-verifies, but we fail fast here with a clean error before we spend
    // money on a Modal invocation.
    const { data: box } = await supabase
      .from("boxes")
      .select("id, workspace_id")
      .eq("id", input.boxId)
      .maybeSingle();
    if (!box || box.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Target box not found in this workspace." };
    }

    // Per-tier monthly quota gate. Admins bypass. The check runs *before*
    // we create the operator_runs row so a denied request leaves no state
    // behind — the usage counter is only incremented in safeRecordUsage()
    // after a successful dispatch, so calling gateOnQuota() here is
    // idempotent: a denied call does not charge the user, and repeat
    // calls at the limit return the same error rather than silently
    // stacking extra bookkeeping rows.
    const quotaGate = await gateOnQuota(supabase, ctx.user, ctx.workspace.id);
    if (!quotaGate.ok) {
      return quotaGate;
    }

    const model = resolveModel(input.model);

    // Persist the run row first so we have a stable id to send to Modal as
    // the canonical run_id. The DB is the source of truth for run state from
    // here on out — the previous random-UUID flow generated an id that was
    // forgotten the moment the request returned.
    const runRow = await createOperatorRun(supabase, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      prompt,
      mode: "full",
      model,
      maxInputTokens: input.maxInputTokens ?? null,
      maxOutputTokens: input.maxOutputTokens ?? null,
      sessionId: input.sessionId ?? null,
    });
    const runId = runRow.id;
    const branchName = (input.branchName ?? `agent/${runId.slice(0, 8)}`).slice(0, 200);

    const branch = await createDraftBranch(supabase, {
      workspace_id: ctx.workspace.id,
      name: branchName,
      description: `Workspace Operator run ${runId}: ${prompt.slice(0, 200)}`,
      created_by: ctx.user.id,
    });

    // Now that the branch exists, attach it to the run and flip status to
    // executing — the dispatch is synchronous in v1 so this is a thin
    // transition, but we record it for any out-of-band readers.
    await safeUpdateRun(supabase, runId, {
      branchId: branch.id,
      status: "executing",
    });

    const startedAt = Date.now();
    let result: OperatorRunResult;
    try {
      result = await dispatchOperatorRun({
        runId,
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        branchId: branch.id,
        boxId: input.boxId,
        prompt,
        model,
        maxInputTokens: input.maxInputTokens ?? null,
        maxOutputTokens: input.maxOutputTokens ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startedAt;
      // Audit the dispatch failure so the branch doesn't look like a mystery.
      await safeAudit(supabase, {
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        branchId: branch.id,
        runId,
        eventType: "workspace_operator.dispatch_failed",
        metadata: { error: message, prompt: prompt.slice(0, 200) },
      });
      await safeUpdateRun(supabase, runId, {
        status: "failed",
        error: message,
        durationMs,
      });
      // Record the failed run in the monthly usage rollup — failures still
      // count against the per-tier run quota.
      await safeRecordUsage(supabase, {
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        result: null,
      });
      await safeNotify(supabase, runId, "failed");
      return { ok: false, error: `Operator dispatch failed: ${message}` };
    }

    const durationMs = Date.now() - startedAt;

    await safeUpdateRun(supabase, runId, {
      status: result.status === "completed" ? "completed" : "failed",
      result: result as unknown,
      error: result.error ?? null,
      notesCreated: result.notes_created,
      toolCalls: result.tool_calls,
      durationMs,
      // Phase 4 — persist token usage + model on the run row so the history
      // view can surface cost and cache-hit rate per run without re-parsing
      // the `result` jsonb. Coalesce missing fields to 0 (backward compat
      // with older Modal responses).
      inputTokens: result.input_tokens ?? 0,
      outputTokens: result.output_tokens ?? 0,
      cachedInputTokens: result.cached_input_tokens ?? 0,
      model: result.model ?? null,
    });

    await safeNotify(
      supabase,
      runId,
      result.status === "completed" ? "completed" : "failed"
    );

    // Metered usage — record exactly once per dispatched run regardless of
    // final status. Token counts come from Agent C's capture work; they'll
    // be undefined (→ 0) until that lands.
    await safeRecordUsage(supabase, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      result,
    });

    await safeAudit(supabase, {
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      branchId: branch.id,
      runId,
      eventType:
        result.status === "completed"
          ? "workspace_operator.run_completed"
          : "workspace_operator.run_failed",
      metadata: {
        notes_created: result.notes_created.length,
        tool_calls: result.tool_calls,
        error: result.error ?? null,
      },
    });

    return {
      ok: true,
      data: {
        run_id: runId,
        branch_id: branch.id,
        status: result.status,
        notes_created: result.notes_created,
        tool_calls: result.tool_calls,
        error: result.error ?? null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to run Workspace Operator.",
    };
  }
}

// ---------------------------------------------------------------------------
// Phase 2: plan → approve → execute flow
// ---------------------------------------------------------------------------

export interface RequestPlanInput {
  prompt: string;
  boxId: string;
  branchName?: string;
  /** Operator model to use. Default = cheapest. */
  model?: OperatorModel;
  /** Optional per-run input-token cap. */
  maxInputTokens?: number | null;
  /** Optional per-run output-token cap. */
  maxOutputTokens?: number | null;
  /** Session to associate this run with. (Phase 12) */
  sessionId?: string | null;
}

export interface RequestPlanOutput {
  run_id: string;
  branch_id: string;
  steps: OperatorPlanStep[];
  summary: string;
}

/**
 * Request a plan from the Workspace Operator without executing it.
 *
 * Phase 2 flow — step 1:
 *   1. Auth + feature flag check
 *   2. Create a fresh draft branch scoped to the current user
 *   3. POST to the Modal endpoint in "plan" mode
 *   4. Record an audit event for plan generation
 *   5. Return the plan steps (each marked "pending") to the UI
 */
export async function requestOperatorPlanAction(
  input: RequestPlanInput
): Promise<ActionResult<RequestPlanOutput>> {
  try {
    if (!isWorkspaceOperatorEnabled()) {
      return { ok: false, error: "Workspace Operator is not enabled." };
    }

    const prompt = input.prompt?.trim();
    if (!prompt) return { ok: false, error: "Prompt is required." };
    if (prompt.length > 4000)
      return { ok: false, error: "Prompt must be 4000 characters or fewer." };
    if (!input.boxId?.trim())
      return { ok: false, error: "boxId is required." };

    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();

    const { data: box } = await supabase
      .from("boxes")
      .select("id, workspace_id")
      .eq("id", input.boxId)
      .maybeSingle();
    if (!box || box.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Target box not found in this workspace." };
    }

    // Per-tier monthly quota gate (see note on the full-run action).
    // We check before `createOperatorRun` so denied requests leave no
    // trace and the quota accounting stays honest.
    const quotaGate = await gateOnQuota(supabase, ctx.user, ctx.workspace.id);
    if (!quotaGate.ok) {
      return quotaGate;
    }

    const model = resolveModel(input.model);

    // Create the run row up-front so the run_id we send to Modal is the same
    // id the UI / history page will display.
    const runRow = await createOperatorRun(supabase, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      prompt,
      mode: "plan",
      model,
      maxInputTokens: input.maxInputTokens ?? null,
      maxOutputTokens: input.maxOutputTokens ?? null,
      sessionId: input.sessionId ?? null,
    });
    const runId = runRow.id;
    const branchName = (input.branchName ?? `agent/${runId.slice(0, 8)}`).slice(
      0,
      200
    );

    const branch = await createDraftBranch(supabase, {
      workspace_id: ctx.workspace.id,
      name: branchName,
      description: `Workspace Operator plan ${runId}: ${prompt.slice(0, 200)}`,
      created_by: ctx.user.id,
    });

    await safeUpdateRun(supabase, runId, {
      branchId: branch.id,
      status: "planning",
    });

    let plan: OperatorPlanResult;
    try {
      plan = await dispatchOperatorPlan({
        runId,
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        branchId: branch.id,
        boxId: input.boxId,
        prompt,
        model,
        maxInputTokens: input.maxInputTokens ?? null,
        maxOutputTokens: input.maxOutputTokens ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await safeUpdateRun(supabase, runId, {
        status: "failed",
        error: message,
      });
      throw err;
    }

    await safeUpdateRun(supabase, runId, {
      status: "awaiting_approval",
      plan: plan as unknown,
    });

    // Gap #5 — fire an email when the plan is ready for review. Gated on
    // `email_on_approval_needed`; safeNotify swallows any send error so this
    // never blocks the plan from being surfaced in the UI.
    await safeNotify(supabase, runId, "awaiting_approval");

    await safeAudit(supabase, {
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      branchId: branch.id,
      runId,
      eventType: "workspace_operator.plan_generated",
      metadata: {
        steps: plan.steps.length,
        summary: plan.summary.slice(0, 200),
      },
    });

    return {
      ok: true,
      data: {
        run_id: runId,
        branch_id: branch.id,
        steps: plan.steps.map((s) => ({
          ...s,
          status: "pending" as const,
        })),
        summary: plan.summary,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to generate plan.",
    };
  }
}

export interface ApproveAndExecuteInput {
  runId: string;
  branchId: string;
  boxId: string;
  prompt: string;
  /**
   * Approved (and possibly user-edited) plan steps. Replaces whatever
   * the planner originally returned — the agent re-renders system
   * context against this exact list. Use `editedSteps` if you want to
   * be explicit at the call site that the array is the post-edit
   * version; both names point at the same field for backwards compat.
   */
  steps: Array<{ index: number; description: string; tool: string }>;
  /**
   * Alias for `steps` — added when wiring the panel's plan-edit UI so
   * client code reads as "edited steps round-trip back". Server prefers
   * `editedSteps` when both are supplied (they should be identical, but
   * the alias wins if they ever drift).
   */
  editedSteps?: EditedOperatorPlanStep[];
  /** Operator model to execute with. Default = cheapest. */
  model?: OperatorModel;
  /** Optional per-run input-token cap. */
  maxInputTokens?: number | null;
  /** Optional per-run output-token cap. */
  maxOutputTokens?: number | null;
}

export interface ApproveAndExecuteOutput {
  run_id: string;
  branch_id: string;
  status: OperatorRunResult["status"];
  notes_created: string[];
  tool_calls: number;
  error?: string | null;
}

/**
 * Approve a previously generated plan and execute it.
 *
 * Phase 2 flow — step 2:
 *   1. Auth + feature flag check
 *   2. POST to the Modal endpoint in "execute" mode with the approved plan
 *   3. Modal calls back with progress events via /api/agent/tools/progress
 *   4. Record an audit event on completion or failure
 *   5. Return the final run result to the UI
 */
export async function approveAndExecuteAction(
  input: ApproveAndExecuteInput
): Promise<ActionResult<ApproveAndExecuteOutput>> {
  try {
    if (!isWorkspaceOperatorEnabled()) {
      return { ok: false, error: "Workspace Operator is not enabled." };
    }

    if (!input.runId || !input.branchId || !input.boxId) {
      return { ok: false, error: "runId, branchId, and boxId are required." };
    }
    // Prefer the explicit `editedSteps` alias when supplied so the wire
    // shape is unambiguous about which copy of the plan the agent should
    // use. Fall back to the legacy `steps` field for compat.
    const approvedSteps =
      input.editedSteps && input.editedSteps.length > 0
        ? input.editedSteps
        : input.steps;
    if (!approvedSteps?.length) {
      return { ok: false, error: "At least one plan step is required." };
    }

    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();

    // Per-tier monthly quota gate. The plan step already consumed a run
    // for quota purposes (usage was recorded when the plan landed), but
    // we re-check here in case the user crossed the limit between the
    // plan and the approve+execute step. This stays idempotent: usage
    // is only incremented in safeRecordUsage() below, never inside the
    // quota check itself.
    const quotaGate = await gateOnQuota(supabase, ctx.user, ctx.workspace.id);
    if (!quotaGate.ok) {
      return quotaGate;
    }

    const model = resolveModel(input.model);

    // The run row already exists from requestOperatorPlanAction; flip it to
    // executing and capture the approved (post-edit) plan so the history
    // page renders what the agent actually ran, not the pre-edit copy.
    await safeUpdateRun(supabase, input.runId, {
      status: "executing",
      plan: approvedSteps as unknown,
      branchId: input.branchId,
      model,
      maxInputTokens: input.maxInputTokens ?? null,
      maxOutputTokens: input.maxOutputTokens ?? null,
    });

    const startedAt = Date.now();
    let result: OperatorRunResult;
    try {
      result = await dispatchOperatorExecute({
        runId: input.runId,
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        branchId: input.branchId,
        boxId: input.boxId,
        prompt: input.prompt,
        approvedPlan: approvedSteps,
        model,
        maxInputTokens: input.maxInputTokens ?? null,
        maxOutputTokens: input.maxOutputTokens ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startedAt;
      await safeAudit(supabase, {
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        branchId: input.branchId,
        runId: input.runId,
        eventType: "workspace_operator.execute_failed",
        metadata: { error: message },
      });
      await safeUpdateRun(supabase, input.runId, {
        status: "failed",
        error: message,
        durationMs,
      });
      // Record the failed run in the monthly usage rollup — failures still
      // count against the per-tier run quota (Agent B enforces).
      await safeRecordUsage(supabase, {
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        result: null,
      });
      await safeNotify(supabase, input.runId, "failed");
      return { ok: false, error: `Operator execution failed: ${message}` };
    }

    const durationMs = Date.now() - startedAt;

    await safeUpdateRun(supabase, input.runId, {
      status: result.status === "completed" ? "completed" : "failed",
      result: result as unknown,
      error: result.error ?? null,
      notesCreated: result.notes_created,
      toolCalls: result.tool_calls,
      durationMs,
      // Phase 4 — persist token usage + model on the run row (see full-mode
      // completion for the rationale).
      inputTokens: result.input_tokens ?? 0,
      outputTokens: result.output_tokens ?? 0,
      cachedInputTokens: result.cached_input_tokens ?? 0,
      model: result.model ?? null,
    });

    await safeNotify(
      supabase,
      input.runId,
      result.status === "completed" ? "completed" : "failed"
    );

    // Metered usage — record exactly once per executed run regardless of
    // final status. Token counts come from Agent C's capture work; they'll
    // be undefined (→ 0) until that lands.
    await safeRecordUsage(supabase, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      result,
    });

    await safeAudit(supabase, {
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      branchId: input.branchId,
      runId: input.runId,
      eventType:
        result.status === "completed"
          ? "workspace_operator.run_completed"
          : "workspace_operator.run_failed",
      metadata: {
        notes_created: result.notes_created.length,
        tool_calls: result.tool_calls,
        error: result.error ?? null,
      },
    });

    return {
      ok: true,
      data: {
        run_id: input.runId,
        branch_id: input.branchId,
        status: result.status,
        notes_created: result.notes_created,
        tool_calls: result.tool_calls,
        error: result.error ?? null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to execute plan.",
    };
  }
}

// ---------------------------------------------------------------------------
// Wave 2 — cancel + retry + saved prompts
// ---------------------------------------------------------------------------

export interface CancelRunOutput {
  runId: string;
  status: string;
  cancellationRequestedAt: string | null;
}

/**
 * User-initiated cancellation of an in-flight Operator run.
 *
 * Flips `cancellation_requested_at` on the runs row. The Modal-side Python
 * operator polls for this between phases (and during long-running execute)
 * and aborts when it sees the flag — the previous local-state-only Cancel
 * button was a UI lie that did nothing on the agent side.
 *
 * No-op when the run is already terminal; the action returns the row as-is
 * so the panel doesn't have to special-case "race won by completion".
 */
export async function cancelRunAction(
  runId: string
): Promise<ActionResult<CancelRunOutput>> {
  try {
    if (!runId) return { ok: false, error: "runId is required." };

    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();
    const row = await cancelOperatorRun(supabase, runId, ctx.user.id);

    // Gap #5 — fire an email on cancel. Gated on `email_on_cancel`. We send
    // at user-initiated cancel time (i.e. when the `cancellation_requested_at`
    // flag flips); the Python side eventually flips `status="cancelled"`
    // but the user has already asked for the email here, which is the
    // moment the intent is known.
    await safeNotify(supabase, runId, "cancelled");

    return {
      ok: true,
      data: {
        runId: row.id,
        status: row.status,
        cancellationRequestedAt: row.cancellation_requested_at,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to cancel run.",
    };
  }
}

export interface RetryRunOutput {
  /** Freshly-minted run id for the new attempt. */
  newRunId: string;
  /** The original prompt — surfaced so the panel can re-seed the textarea. */
  prompt: string;
  branchId: string | null;
  /** Model the new run will use (mirrors the original). */
  model: string | null;
  mode: "plan" | "execute" | "full";
}

/**
 * Re-run a terminal Operator run with the same prompt / branch / model.
 *
 * Creates a fresh runs row mirroring the failed (or completed) source run
 * and returns the new id. Does NOT itself dispatch — the caller (the panel)
 * picks the new id up and either calls `requestOperatorPlanAction` or
 * `runWorkspaceOperatorAction` depending on the mode, so retry composes
 * with the existing quota gate / dispatch path.
 */
export async function retryRunAction(
  runId: string
): Promise<ActionResult<RetryRunOutput>> {
  try {
    if (!runId) return { ok: false, error: "runId is required." };

    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();
    const newRow = await retryOperatorRun(supabase, runId, ctx.user.id);

    return {
      ok: true,
      data: {
        newRunId: newRow.id,
        prompt: newRow.prompt,
        branchId: newRow.branch_id,
        model: newRow.model,
        mode: newRow.mode,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to retry run.",
    };
  }
}

/**
 * List the current user's saved Operator prompts (per workspace).
 *
 * Backed by Agent G's `operator_prompts_service`. If that service drifts
 * at integration time, this action is the one place that needs to be
 * patched — the panel only ever sees the narrow `SavedOperatorPrompt`
 * shape declared in `./types`.
 */
export async function listSavedPromptsAction(): Promise<
  ActionResult<SavedOperatorPrompt[]>
> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const rows = await listOperatorPrompts(supabase, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
    });
    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        prompt: r.prompt,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load prompts.",
    };
  }
}

export interface SaveOperatorPromptInput {
  name: string;
  prompt: string;
}

/**
 * Persist a new saved prompt under the current (workspace, user) pair.
 * Surfaces the duplicate-name error verbatim so the panel can render it.
 */
export async function saveOperatorPromptAction(
  input: SaveOperatorPromptInput
): Promise<ActionResult<SavedOperatorPrompt>> {
  try {
    if (!input.name?.trim() || !input.prompt?.trim()) {
      return { ok: false, error: "Name and prompt are required." };
    }

    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const row = await createOperatorPrompt(supabase, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      name: input.name.trim(),
      prompt: input.prompt.trim(),
    });
    return {
      ok: true,
      data: { id: row.id, name: row.name, prompt: row.prompt },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save prompt.",
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function safeAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    workspaceId: string;
    actorId: string;
    branchId: string;
    runId: string;
    eventType: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await createAuditEvent(supabase, {
      workspace_id: params.workspaceId,
      actor_type: "user",
      actor_id: params.actorId,
      object_type: "draft_branch",
      object_id: params.branchId,
      event_type: params.eventType,
      metadata: { run_id: params.runId, ...params.metadata },
    });
  } catch (err) {
    console.error("[workspace_operator] audit write failed", err);
  }
}

/**
 * Update the workspace_operator_runs row, swallowing failures so a flake
 * in run-state bookkeeping never breaks the user-visible action. The
 * dispatch result is the source of truth returned to the caller; the run
 * row is best-effort persistence for the history view.
 */
async function safeUpdateRun(
  supabase: Awaited<ReturnType<typeof createClient>>,
  runId: string,
  patch: Parameters<typeof updateOperatorRun>[2]
): Promise<void> {
  try {
    await updateOperatorRun(supabase, runId, patch);
  } catch (err) {
    console.error("[workspace_operator] run row update failed", err);
  }
}

/**
 * Upsert the current-month workspace_operator_usage rollup, swallowing
 * failures so usage bookkeeping never breaks the user-visible action.
 * Every Operator run — success *or* failure — should call this once.
 * Failed runs contribute `runCount: 1` with zero tokens so they still
 * count against the per-tier run quota that Agent B enforces.
 *
 * Token / model fields are coalesced from the OperatorResult when present.
 * Until Agent C lands the Python-side token capture they'll be undefined
 * and the cost estimate resolves to zero.
 */
/**
 * Best-effort notification dispatcher. Never throws — the caller's action
 * result is the source of truth; notification flakes only show up in logs
 * (the service itself logs structured fields per outcome).
 *
 * Outcome union extended in gap #5 beyond the original binary
 * complete/failed to include:
 *   - "awaiting_approval" — plan-mode run reached awaiting_approval
 *   - "cancelled"         — user-initiated cancellation via cancelRunAction
 *
 * Each outcome is gated on its own per-user preference column in
 * `operator_notification_preferences`; the service short-circuits when the
 * user has not opted in for that specific event.
 */
export async function safeNotify(
  supabase: Awaited<ReturnType<typeof createClient>>,
  runId: string,
  outcome: "completed" | "failed" | "awaiting_approval" | "cancelled"
): Promise<void> {
  try {
    switch (outcome) {
      case "completed":
        await notifyRunCompleted(supabase, runId);
        break;
      case "failed":
        await notifyRunFailed(supabase, runId);
        break;
      case "awaiting_approval":
        await notifyRunAwaitingApproval(supabase, runId);
        break;
      case "cancelled":
        await notifyRunCancelled(supabase, runId);
        break;
    }
  } catch (err) {
    console.error("[workspace_operator] notification failed", err);
  }
}

async function safeRecordUsage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    workspaceId: string;
    userId: string;
    result?: OperatorRunResult | null;
    toolCalls?: number;
  }
): Promise<void> {
  try {
    const result = params.result ?? null;
    await recordOperatorUsage(supabase, {
      workspaceId: params.workspaceId,
      userId: params.userId,
      runCount: 1,
      toolCallCount: params.toolCalls ?? result?.tool_calls ?? 0,
      inputTokens: result?.input_tokens ?? 0,
      outputTokens: result?.output_tokens ?? 0,
      model: result?.model,
    });
  } catch (err) {
    console.error("[workspace_operator] usage row record failed", err);
  }
}

