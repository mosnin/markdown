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
import { isWorkspaceOperatorEnabled } from "@/lib/env";
import { AGENT_HEADERS } from "@/app/api/agent/_lib/auth";

export interface OperatorDispatchInput {
  runId: string;
  userId: string;
  workspaceId: string;
  branchId: string;
  boxId: string;
  prompt: string;
  /** Deadline in milliseconds; aborts the outbound call if exceeded. */
  timeoutMs?: number;
}

export interface OperatorRunResult {
  run_id: string;
  status: "completed" | "failed";
  notes_created: string[];
  tool_calls: number;
  error?: string | null;
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
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
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
      const text = await response.text().catch(() => "");
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
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
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
    };
  } finally {
    clearTimeout(timer);
  }
}
