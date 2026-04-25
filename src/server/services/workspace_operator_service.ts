/**
 * Workspace Operator dispatch service.
 *
 * The Workspace Operator is a Python-based agent that runs in Modal. It is
 * NOT the same thing as the DB-stored `agents` table managed by
 * `agent_service.ts` — those are user-defined markdown artifacts. The
 * Operator is LLM infrastructure: a single OpenAI Agents SDK agent
 * definition, with a fixed toolbelt, invoked per-run against a workspace
 * and a draft branch.
 *
 * This service is the Next.js side of the boundary. Its job is narrow:
 *   1. Validate that the feature flag is on and endpoint config is present.
 *   2. POST to the Modal function with a signed envelope.
 *   3. Return the final result (note IDs created, tool call summary).
 *
 * Every tool call inside the agent loop is a callback into this app at
 * `/api/agent/tools/*`. See `src/app/api/agent/_lib/auth.ts` for the
 * shared-secret verification used on that side.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { isWorkspaceOperatorEnabled } from "@/lib/env";
import { AGENT_HEADERS } from "@/app/api/agent/_lib/auth";
import {
  createOperatorRun,
  getOperatorRun,
  updateOperatorRun,
  type WorkspaceOperatorRunRow,
} from "@/server/services/workspace_operator_runs_service";

export interface OperatorDispatchInput {
  runId: string;
  userId: string;
  workspaceId: string;
  branchId: string;
  boxId: string;
  prompt: string;
  /** Deadline in milliseconds; aborts the outbound call if exceeded. */
  timeoutMs?: number;
  /**
   * Optional model id forwarded to the Modal agent. When omitted, the
   * Python settings default (`WORKSPACE_OPERATOR_MODEL`) wins. The agent
   * will reject any model not in `ALLOWED_OPERATOR_MODELS`. (Wave 1 F)
   */
  model?: string | null;
  /** Optional per-run input-token cap. NULL means unlimited. (Wave 1 F) */
  maxInputTokens?: number | null;
  /** Optional per-run output-token cap. NULL means unlimited. (Wave 1 F) */
  maxOutputTokens?: number | null;
}

export interface OperatorRunResult {
  run_id: string;
  status: "completed" | "failed";
  notes_created: string[];
  tool_calls: number;
  error?: string | null;
  /**
   * Token usage reported by the Modal agent. Phase 4-Agent-C adds these
   * fields to the Python side; until that ships they'll be undefined and
   * the usage service treats them as zero. Consumers should never rely
   * on these being present — coalesce with `?? 0` at the call site.
   */
  input_tokens?: number;
  output_tokens?: number;
  /**
   * Portion of input_tokens OpenAI billed at the cached rate. Subset of
   * input_tokens, not a separate category. Used for cache-hit-rate observability.
   */
  cached_input_tokens?: number;
  /** Model id used for the run — feeds cost estimation. Optional. */
  model?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export function assertOperatorEnabled(): void {
  if (!isWorkspaceOperatorEnabled()) {
    throw new Error(
      "Workspace Operator is not enabled. Set WORKSPACE_OPERATOR_ENABLED=true and configure WORKSPACE_OPERATOR_URL + WORKSPACE_OPERATOR_SHARED_SECRET."
    );
  }
}

/**
 * POST to the Modal Operator endpoint and return the final run result.
 * The Modal function is synchronous in v1 — it blocks until the agent loop
 * terminates (or `timeoutMs` is reached). Phase 2 will move to streaming.
 *
 * Injectable `fetchImpl` makes this trivially testable.
 */
export async function dispatchOperatorRun(
  input: OperatorDispatchInput,
  fetchImpl: typeof fetch = fetch
): Promise<OperatorRunResult> {
  assertOperatorEnabled();

  const endpoint = process.env.WORKSPACE_OPERATOR_URL!;
  const secret = process.env.WORKSPACE_OPERATOR_SHARED_SECRET!;

  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [AGENT_HEADERS.SECRET]: secret,
        [AGENT_HEADERS.USER_ID]: input.userId,
        [AGENT_HEADERS.WORKSPACE_ID]: input.workspaceId,
        [AGENT_HEADERS.BRANCH_ID]: input.branchId,
        [AGENT_HEADERS.RUN_ID]: input.runId,
      },
      body: JSON.stringify({
        run_id: input.runId,
        user_id: input.userId,
        workspace_id: input.workspaceId,
        branch_id: input.branchId,
        box_id: input.boxId,
        prompt: input.prompt,
        ...(input.model !== undefined && input.model !== null
          ? { model: input.model }
          : {}),
        ...(input.maxInputTokens !== undefined && input.maxInputTokens !== null
          ? { max_input_tokens: input.maxInputTokens }
          : {}),
        ...(input.maxOutputTokens !== undefined && input.maxOutputTokens !== null
          ? { max_output_tokens: input.maxOutputTokens }
          : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch((err) => { logger.warn({ err }, "failed to read Workspace Operator error response body"); return ""; });
      throw new Error(
        `Workspace Operator endpoint returned ${response.status}: ${text.slice(0, 500)}`
      );
    }

    const payload = (await response.json()) as Partial<OperatorRunResult>;
    if (typeof payload.run_id !== "string" || typeof payload.status !== "string") {
      throw new Error("Malformed response from Workspace Operator");
    }

    return {
      run_id: payload.run_id,
      status: payload.status === "completed" ? "completed" : "failed",
      notes_created: Array.isArray(payload.notes_created) ? payload.notes_created : [],
      tool_calls: typeof payload.tool_calls === "number" ? payload.tool_calls : 0,
      error: payload.error ?? null,
      input_tokens:
        typeof payload.input_tokens === "number" ? payload.input_tokens : undefined,
      output_tokens:
        typeof payload.output_tokens === "number" ? payload.output_tokens : undefined,
      cached_input_tokens:
        typeof payload.cached_input_tokens === "number"
          ? payload.cached_input_tokens
          : undefined,
      model: typeof payload.model === "string" ? payload.model : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: plan + execute dispatchers
// ---------------------------------------------------------------------------

export interface OperatorPlanResult {
  run_id: string;
  steps: Array<{ index: number; description: string; tool: string }>;
  summary: string;
}

/**
 * POST to the Modal Operator endpoint in "plan" mode.
 * Returns a structured plan (steps + summary) without executing anything.
 */
export async function dispatchOperatorPlan(
  input: OperatorDispatchInput,
  fetchImpl: typeof fetch = fetch
): Promise<OperatorPlanResult> {
  assertOperatorEnabled();

  const endpoint = process.env.WORKSPACE_OPERATOR_URL!;
  const secret = process.env.WORKSPACE_OPERATOR_SHARED_SECRET!;

  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [AGENT_HEADERS.SECRET]: secret,
        [AGENT_HEADERS.USER_ID]: input.userId,
        [AGENT_HEADERS.WORKSPACE_ID]: input.workspaceId,
        [AGENT_HEADERS.BRANCH_ID]: input.branchId,
        [AGENT_HEADERS.RUN_ID]: input.runId,
      },
      body: JSON.stringify({
        run_id: input.runId,
        user_id: input.userId,
        workspace_id: input.workspaceId,
        branch_id: input.branchId,
        box_id: input.boxId,
        prompt: input.prompt,
        mode: "plan",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch((err) => { logger.warn({ err }, "failed to read Operator plan error response body"); return ""; });
      throw new Error(
        `Operator plan endpoint returned ${response.status}: ${text.slice(0, 500)}`
      );
    }

    const payload = await response.json();
    const plan = payload.plan;
    if (!plan || !Array.isArray(plan.steps)) {
      throw new Error("Malformed plan response from Workspace Operator");
    }

    return {
      run_id: payload.run_id ?? input.runId,
      steps: plan.steps,
      summary: plan.summary ?? "",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST to the Modal Operator endpoint in "execute" mode with an approved plan.
 * The Modal function executes each step and calls back with progress events.
 * Uses a longer default timeout (5 min) since execution involves multiple
 * tool invocations.
 */
export async function dispatchOperatorExecute(
  input: OperatorDispatchInput & {
    approvedPlan: Array<{ index: number; description: string; tool: string }>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<OperatorRunResult> {
  assertOperatorEnabled();

  const endpoint = process.env.WORKSPACE_OPERATOR_URL!;
  const secret = process.env.WORKSPACE_OPERATOR_SHARED_SECRET!;

  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 300_000; // 5 min for execution
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [AGENT_HEADERS.SECRET]: secret,
        [AGENT_HEADERS.USER_ID]: input.userId,
        [AGENT_HEADERS.WORKSPACE_ID]: input.workspaceId,
        [AGENT_HEADERS.BRANCH_ID]: input.branchId,
        [AGENT_HEADERS.RUN_ID]: input.runId,
      },
      body: JSON.stringify({
        run_id: input.runId,
        user_id: input.userId,
        workspace_id: input.workspaceId,
        branch_id: input.branchId,
        box_id: input.boxId,
        prompt: input.prompt,
        mode: "execute",
        approved_plan: input.approvedPlan,
        ...(input.model !== undefined && input.model !== null
          ? { model: input.model }
          : {}),
        ...(input.maxInputTokens !== undefined && input.maxInputTokens !== null
          ? { max_input_tokens: input.maxInputTokens }
          : {}),
        ...(input.maxOutputTokens !== undefined && input.maxOutputTokens !== null
          ? { max_output_tokens: input.maxOutputTokens }
          : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch((err) => { logger.warn({ err }, "failed to read Operator execute error response body"); return ""; });
      throw new Error(
        `Operator execute endpoint returned ${response.status}: ${text.slice(0, 500)}`
      );
    }

    const result = (await response.json()) as Partial<OperatorRunResult>;
    if (typeof result.run_id !== "string" || typeof result.status !== "string") {
      throw new Error("Malformed response from Workspace Operator");
    }

    return {
      run_id: result.run_id,
      status: result.status === "completed" ? "completed" : "failed",
      notes_created: Array.isArray(result.notes_created) ? result.notes_created : [],
      tool_calls: typeof result.tool_calls === "number" ? result.tool_calls : 0,
      error: result.error ?? null,
      input_tokens:
        typeof result.input_tokens === "number" ? result.input_tokens : undefined,
      output_tokens:
        typeof result.output_tokens === "number" ? result.output_tokens : undefined,
      cached_input_tokens:
        typeof result.cached_input_tokens === "number"
          ? result.cached_input_tokens
          : undefined,
      model: typeof result.model === "string" ? result.model : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Wave 1 F — cancellation + retry helpers
// ---------------------------------------------------------------------------

/**
 * Terminal statuses where neither cancellation nor retry should mutate state.
 * Mirrors the OperatorRunStatus union in `workspace_operator_runs_service.ts`.
 */
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

/**
 * Mark a run as cancellation-requested.
 *
 * The Modal Python operator polls `/api/agent/operator/check_cancel` between
 * phases (and periodically during long-running execute) and aborts when this
 * column flips. The Cancel button in the UI should call a server action that
 * delegates here — actually flipping the column is what makes the OpenAI
 * agent loop stop burning tokens (the previous local-state-only Cancel was
 * a UI lie).
 *
 * Behaviour:
 *   - Asserts the requesting user owns the run (we never let user A cancel
 *     user B's run, even if both are workspace members).
 *   - No-op when the run is already terminal — returns the row as-is so the
 *     caller can render without special-casing.
 *   - Does not change `status`. The Python side is responsible for writing
 *     `status="cancelled"` once it actually stops.
 */
export async function cancelOperatorRun(
  supabase: SupabaseClient,
  runId: string,
  userId: string
): Promise<WorkspaceOperatorRunRow> {
  const existing = await getOperatorRun(supabase, runId);
  if (!existing) throw new Error("Operator run not found");
  if (existing.user_id !== userId) {
    throw new Error("forbidden: only the run's owner can cancel it");
  }
  if (TERMINAL_STATUSES.has(existing.status)) {
    return existing; // already terminal, no-op
  }
  if (existing.cancellation_requested_at) {
    return existing; // already requested
  }
  return updateOperatorRun(supabase, runId, {
    cancellationRequestedAt: new Date().toISOString(),
  });
}

/**
 * Create a fresh run row mirroring an existing one's prompt/branch/mode/model.
 *
 * Does NOT dispatch — the caller (Wave 2 server action) decides whether to
 * also kick the Modal endpoint. We stay narrowly scoped because the dispatch
 * call hits a different code path (and we want retry semantics to compose
 * with throttling / quota gates that the action layer owns).
 *
 * Returns the new row including the freshly minted `id`. The caller passes
 * that id to `dispatchOperatorRun` (or its plan/execute siblings) to actually
 * run the agent again.
 */
export async function retryOperatorRun(
  supabase: SupabaseClient,
  runId: string,
  userId: string
): Promise<WorkspaceOperatorRunRow> {
  const existing = await getOperatorRun(supabase, runId);
  if (!existing) throw new Error("Operator run not found");
  if (existing.user_id !== userId) {
    throw new Error("forbidden: only the run's owner can retry it");
  }
  if (!TERMINAL_STATUSES.has(existing.status)) {
    throw new Error(
      `cannot retry a non-terminal run (status=${existing.status})`
    );
  }
  return createOperatorRun(supabase, {
    workspaceId: existing.workspace_id,
    userId: existing.user_id,
    branchId: existing.branch_id,
    prompt: existing.prompt,
    mode: existing.mode,
    model: existing.model,
    maxInputTokens: existing.max_input_tokens,
    maxOutputTokens: existing.max_output_tokens,
  });
}
