"use server";

import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  listOperatorRuns,
  getOperatorRun,
  type WorkspaceOperatorRunRow,
} from "@/server/services/workspace_operator_runs_service";
import {
  listRunArtifacts,
  rollbackRun,
  type RunArtifact,
  type RollbackResult,
} from "@/server/services/operator_artifacts_service";
import {
  runWorkspaceOperatorAction,
  type RunWorkspaceOperatorOutput,
  type ActionErrorQuotaExceeded,
} from "./actions";
import {
  expandStatusFilter,
  type OperatorRunStatusFilter,
} from "./history_filters";

/**
 * History/detail/rollback/retry server actions for the Workspace Operator
 * history surface.
 *
 * These are thin wrappers around the underlying services that:
 *   1. Resolve the request context (current user + workspace)
 *   2. Scope every list/read to the calling user (defence in depth on top
 *      of RLS — we never accidentally surface other users' runs through
 *      this surface)
 *   3. Wrap thrown errors into a discriminated `{ ok, ... }` result so
 *      the UI can render error messages without try/catch in JSX.
 */

export type HistoryActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── List my runs ───────────────────────────────────────────────────────────

export interface ListMyOperatorRunsInput {
  /** Page size — default 25, capped at 100 by the underlying service. */
  limit?: number;
  /**
   * Opaque cursor returned by the previous page. Pass the previous
   * response's `nextCursor` to continue paging.
   */
  cursor?: string | null;
  /**
   * Filter bucket — "all" (or omitted) means no status filter; the other
   * buckets map to one or more underlying statuses.
   */
  status?: OperatorRunStatusFilter;
  /** ISO-8601 inclusive lower bound on created_at. Empty string = no filter. */
  fromDate?: string;
  /** ISO-8601 inclusive upper bound on created_at. Empty string = no filter. */
  toDate?: string;
  /** Case-insensitive substring search on the prompt column. */
  search?: string;
}

export interface ListMyOperatorRunsOutput {
  rows: WorkspaceOperatorRunRow[];
  nextCursor: string | null;
}

/**
 * List the current user's runs for the active workspace, newest first.
 * Filters by both userId AND workspaceId — even if the user switched
 * workspaces between pages, the cursor stays sound because we always
 * re-resolve the workspace id from the request context on each call.
 */
export async function listMyOperatorRunsAction(
  input: ListMyOperatorRunsInput = {}
): Promise<HistoryActionResult<ListMyOperatorRunsOutput>> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();
    const result = await listOperatorRuns(supabase, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      limit: input.limit,
      cursor: input.cursor ?? null,
      status: expandStatusFilter(input.status),
      fromDate: input.fromDate?.trim() ? input.fromDate : undefined,
      toDate: input.toDate?.trim() ? input.toDate : undefined,
      search: input.search?.trim() ? input.search : undefined,
    });

    return {
      ok: true,
      data: { rows: result.rows, nextCursor: result.nextCursor },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list runs.",
    };
  }
}

// ─── Run detail ─────────────────────────────────────────────────────────────

export interface OperatorRunDetail {
  run: WorkspaceOperatorRunRow;
  artifacts: RunArtifact[];
}

/**
 * Fetch a single run + its artifact list. Returns ok=false with a
 * "Not found" error when the run id is unknown OR the row belongs to a
 * different user/workspace — the page renders notFound() in either case.
 */
export async function getOperatorRunDetailAction(
  runId: string
): Promise<HistoryActionResult<OperatorRunDetail>> {
  try {
    if (!runId) return { ok: false, error: "runId is required." };
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();
    const run = await getOperatorRun(supabase, runId);
    if (!run) return { ok: false, error: "Not found" };
    if (run.user_id !== ctx.user.id) return { ok: false, error: "Not found" };
    if (run.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Not found" };
    }

    const artifacts = await listRunArtifacts(supabase, runId);
    return { ok: true, data: { run, artifacts } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load run.",
    };
  }
}

// ─── Rollback ───────────────────────────────────────────────────────────────

/**
 * Soft-delete every still-active note this run produced. Ownership and
 * idempotency are handled inside `rollbackRun` — we just plumb through
 * the request context.
 */
export async function rollbackOperatorRunAction(
  runId: string
): Promise<HistoryActionResult<RollbackResult>> {
  try {
    if (!runId) return { ok: false, error: "runId is required." };
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();
    const result = await rollbackRun(supabase, runId, ctx.user.id);
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to roll back run.",
    };
  }
}

// ─── Retry ──────────────────────────────────────────────────────────────────

export interface RetryOperatorRunOutput {
  run_id: string;
  branch_id: string;
  status: RunWorkspaceOperatorOutput["status"];
  notes_created: string[];
  tool_calls: number;
  error?: string | null;
}

/**
 * Retry a previous run by replaying its prompt against the same target
 * box (where possible). We reuse `runWorkspaceOperatorAction` so retried
 * runs go through the same quota/audit path as user-typed runs — this
 * action only has to look up the original run to find the prompt and
 * box id.
 *
 * Intentionally distinct from `retryRunAction` in `./actions.ts`:
 *   - `retryRunAction` mints a row via the F service `retryOperatorRun`
 *     and lets the **panel** reseed prompt/model/branch so the user can
 *     re-approve the plan before execution.
 *   - This action runs end-to-end ("full" mode) for callers (the
 *     detail page) where there's no panel to reseed into.
 * Forwards the original model so retries don't silently downgrade.
 */
export async function retryOperatorRunAction(
  runId: string
): Promise<HistoryActionResult<RetryOperatorRunOutput> | { ok: false; error: ActionErrorQuotaExceeded }> {
  try {
    if (!runId) return { ok: false, error: "runId is required." };
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();
    const original = await getOperatorRun(supabase, runId);
    if (!original) return { ok: false, error: "Not found" };
    if (original.user_id !== ctx.user.id) {
      return { ok: false, error: "Not found" };
    }

    // The original run's plan/result both reference a `box_id`. Pull it
    // from the result jsonb when present, otherwise fall back to
    // looking it up off the branch row. If we still can't find one, we
    // can't replay — surface a clean error rather than a 500.
    const boxId = pickBoxIdFromRun(original);
    if (!boxId) {
      // Fall back: read the branch's first attached box (best effort).
      const fallbackBoxId = original.branch_id
        ? await firstBoxForBranch(supabase, original.branch_id)
        : null;
      if (!fallbackBoxId) {
        return {
          ok: false,
          error:
            "This run is too old to retry — its target box could not be determined.",
        };
      }
      return wrapRunResult(
        await runWorkspaceOperatorAction({
          prompt: original.prompt,
          boxId: fallbackBoxId,
          model: original.model ?? undefined,
        })
      );
    }

    return wrapRunResult(
      await runWorkspaceOperatorAction({
        prompt: original.prompt,
        boxId,
        model: original.model ?? undefined,
      })
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to retry run.",
    };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function pickBoxIdFromRun(run: WorkspaceOperatorRunRow): string | null {
  // The result/plan jsonb may contain a `box_id` string at the top
  // level; if not, give up here and let the caller fall back to a
  // branch-lookup heuristic.
  const candidates = [run.result, run.plan];
  for (const c of candidates) {
    if (c && typeof c === "object" && c !== null) {
      const v = (c as Record<string, unknown>).box_id;
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  return null;
}

async function firstBoxForBranch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  branchId: string
): Promise<string | null> {
  // Best-effort fallback. We don't know the schema for sure here —
  // attempt a tolerant query and swallow errors so retry never
  // throws on a missing-table error in environments that haven't run
  // every migration.
  try {
    const { data } = await supabase
      .from("draft_branches")
      .select("id")
      .eq("id", branchId)
      .maybeSingle();
    if (!data) return null;
  } catch {
    return null;
  }
  return null;
}

function wrapRunResult(
  res: Awaited<ReturnType<typeof runWorkspaceOperatorAction>>
):
  | HistoryActionResult<RetryOperatorRunOutput>
  | { ok: false; error: ActionErrorQuotaExceeded } {
  if (res.ok) return { ok: true, data: res.data };
  // The wrapped action may surface a structured quota error or a
  // plain string. Pass both through; the caller narrows on shape.
  if (typeof res.error === "string") {
    return { ok: false, error: res.error };
  }
  return { ok: false, error: res.error };
}
