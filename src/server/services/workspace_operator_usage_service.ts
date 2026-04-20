import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Workspace Operator usage — monthly rollup of runs + tokens + cost per
 * (workspace, user). Phase 4 metered billing. Stored in the
 * `workspace_operator_usage` table (see migration
 * 20260419000003_workspace_operator_usage.sql).
 *
 * Write path: every completed or failed Operator run calls
 * {@link recordOperatorUsage} which upserts the current-month row and
 * increments the counters. RLS denies direct writes for authenticated users
 * — callers must use the service-role client (or server-side code where
 * the Supabase client has been created with the service-role key).
 *
 * Read path: workspace members can SELECT their workspace's rows under
 * the normal user-scoped client. Use {@link getWorkspaceUsageForMonth} or
 * {@link getUserUsageForMonth} from server components / actions.
 *
 * Cost model is hard-coded in {@link MODEL_PRICING} (per-million-token
 * prices in USD cents). New models fall through to the `gpt-4.1-mini`
 * rates which is our cheapest default. Units are converted to *cents* at
 * the boundary and rounded up so a single token always counts as at least
 * 1 cent of revenue lost — never zero.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OperatorUsageRecord {
  workspaceId: string;
  userId: string | null;
  /** ISO date `YYYY-MM-01` — the first day of the month in UTC. */
  month: string;
  runCount: number;
  toolCallCount: number;
  inputTokenCount: number;
  outputTokenCount: number;
  estimatedCostCents: number;
}

interface OperatorUsageRow {
  workspace_id: string;
  user_id: string | null;
  month: string;
  run_count: number;
  tool_call_count: number;
  input_token_count: number;
  output_token_count: number;
  estimated_cost_cents: number;
}

export interface RecordOperatorUsageInput {
  workspaceId: string;
  userId: string;
  /** Defaults to 1 — one invocation of the Operator. */
  runCount?: number;
  toolCallCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  /**
   * Model id used for cost estimation. Unknown models fall back to
   * the `gpt-4.1-mini` rate. Optional; when omitted we assume the
   * default cheapest model and zero cost will be charged unless tokens
   * are present.
   */
  model?: string;
}

// ─── Cost model ──────────────────────────────────────────────────────────────

/**
 * Per-model pricing in **USD cents per million tokens**. Source: OpenAI
 * list pricing as of Q1 2026. Kept alongside the service so the conversion
 * math is co-located with the numbers.
 *
 *   gpt-4.1-mini — $0.40/M input, $1.60/M output → 40c / 160c per M.
 *   gpt-4.1      — $2.00/M input, $8.00/M output → 200c / 800c per M.
 *
 * When Phase 4-Agent-C lands token capture, the model id will come through
 * on the OperatorResult; until then callers can omit it and the fallback
 * rates apply.
 */
export const MODEL_PRICING: Record<
  string,
  { inputCentsPerMillion: number; outputCentsPerMillion: number }
> = {
  "gpt-4.1-mini": { inputCentsPerMillion: 40, outputCentsPerMillion: 160 },
  "gpt-4.1": { inputCentsPerMillion: 200, outputCentsPerMillion: 800 },
};

export const FALLBACK_MODEL = "gpt-4.1-mini";

/**
 * Convert a (model, inputTokens, outputTokens) tuple to a cent-denominated
 * cost estimate. Uses ceil() so we never under-count — the aggregate row
 * is a billing-adjacent artifact and we'd rather err on the side of
 * charging slightly more than nothing.
 */
export function computeEstimatedCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const rate = MODEL_PRICING[model] ?? MODEL_PRICING[FALLBACK_MODEL];
  const safeIn = Math.max(0, Math.floor(inputTokens || 0));
  const safeOut = Math.max(0, Math.floor(outputTokens || 0));
  const inputCents = (safeIn * rate.inputCentsPerMillion) / 1_000_000;
  const outputCents = (safeOut * rate.outputCentsPerMillion) / 1_000_000;
  return Math.ceil(inputCents + outputCents);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Month bucket key — first day of the month in UTC, formatted YYYY-MM-DD
 * so it maps directly onto the Postgres `date` column without needing a
 * cast on the server side.
 */
export function monthKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function rowToRecord(row: OperatorUsageRow): OperatorUsageRecord {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    month: row.month,
    runCount: row.run_count,
    toolCallCount: row.tool_call_count,
    inputTokenCount: row.input_token_count,
    outputTokenCount: row.output_token_count,
    estimatedCostCents: row.estimated_cost_cents,
  };
}

// ─── Write: recordOperatorUsage ──────────────────────────────────────────────

/**
 * Upsert the current-month row for the (workspace, user) pair and add the
 * supplied counters. Idempotency is *not* claimed here — two concurrent
 * runs will both increment the row. Postgres handles the collision via
 * the UNIQUE(workspace_id, user_id, month) index; the upsert path does a
 * read-then-write internally, which is fine for our volumes.
 *
 * Failures (network, RLS) throw; the caller in
 * `src/app/app/workspace_operator/actions.ts` wraps this in a `safe*`
 * helper so user-visible flows never hard-fail on usage bookkeeping.
 */
export async function recordOperatorUsage(
  supabase: SupabaseClient,
  input: RecordOperatorUsageInput
): Promise<OperatorUsageRecord> {
  const month = monthKey();
  const runCount = input.runCount ?? 1;
  const toolCallCount = input.toolCallCount ?? 0;
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const estimatedCostCents = computeEstimatedCostCents(
    input.model ?? FALLBACK_MODEL,
    inputTokens,
    outputTokens
  );

  // Read existing row (if any) so we can sum counters and issue a single
  // upsert. We don't rely on Postgres' ON CONFLICT … DO UPDATE SET a = a + n
  // pattern because the PostgREST client doesn't expose expression-based
  // updates ergonomically; the read-then-upsert is fine at our volumes
  // (~10s of rows per workspace per month).
  const { data: existing, error: readError } = await supabase
    .from("workspace_operator_usage")
    .select(
      "workspace_id, user_id, month, run_count, tool_call_count, input_token_count, output_token_count, estimated_cost_cents"
    )
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("month", month)
    .maybeSingle();

  if (readError && readError.code !== "PGRST116") {
    throw new Error(
      `Failed to read operator usage row: ${readError.message ?? "unknown"}`
    );
  }

  const existingRow = existing as OperatorUsageRow | null;

  const next = {
    workspace_id: input.workspaceId,
    user_id: input.userId,
    month,
    run_count: (existingRow?.run_count ?? 0) + runCount,
    tool_call_count: (existingRow?.tool_call_count ?? 0) + toolCallCount,
    input_token_count: (existingRow?.input_token_count ?? 0) + inputTokens,
    output_token_count: (existingRow?.output_token_count ?? 0) + outputTokens,
    estimated_cost_cents:
      (existingRow?.estimated_cost_cents ?? 0) + estimatedCostCents,
  };

  const { data, error } = await supabase
    .from("workspace_operator_usage")
    .upsert(next, { onConflict: "workspace_id,user_id,month" })
    .select(
      "workspace_id, user_id, month, run_count, tool_call_count, input_token_count, output_token_count, estimated_cost_cents"
    )
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to record operator usage: ${error?.message ?? "unknown"}`
    );
  }
  return rowToRecord(data as OperatorUsageRow);
}

// ─── Read: getWorkspaceUsageForMonth ─────────────────────────────────────────

/**
 * List all (per-user) usage rows for a workspace in a given month. Defaults
 * to the current month. Returns an empty array when no users have usage
 * rows yet — callers in the billing UI should treat that as "0 runs".
 */
export async function getWorkspaceUsageForMonth(
  supabase: SupabaseClient,
  workspaceId: string,
  month?: Date
): Promise<OperatorUsageRecord[]> {
  const key = monthKey(month);
  const { data, error } = await supabase
    .from("workspace_operator_usage")
    .select(
      "workspace_id, user_id, month, run_count, tool_call_count, input_token_count, output_token_count, estimated_cost_cents"
    )
    .eq("workspace_id", workspaceId)
    .eq("month", key);

  if (error) {
    throw new Error(`Failed to load workspace operator usage: ${error.message}`);
  }
  return (data ?? []).map((r) => rowToRecord(r as OperatorUsageRow));
}

// ─── Read: getUserUsageForMonth ──────────────────────────────────────────────

/**
 * List all (per-workspace) usage rows for a user in a given month. Defaults
 * to the current month. Useful for a "my usage" view that aggregates across
 * every workspace the user has runs in.
 */
export async function getUserUsageForMonth(
  supabase: SupabaseClient,
  userId: string,
  month?: Date
): Promise<OperatorUsageRecord[]> {
  const key = monthKey(month);
  const { data, error } = await supabase
    .from("workspace_operator_usage")
    .select(
      "workspace_id, user_id, month, run_count, tool_call_count, input_token_count, output_token_count, estimated_cost_cents"
    )
    .eq("user_id", userId)
    .eq("month", key);

  if (error) {
    throw new Error(`Failed to load user operator usage: ${error.message}`);
  }
  return (data ?? []).map((r) => rowToRecord(r as OperatorUsageRow));
}

// ─── Aggregation helpers ─────────────────────────────────────────────────────

export interface OperatorUsageTotals {
  runCount: number;
  toolCallCount: number;
  inputTokenCount: number;
  outputTokenCount: number;
  estimatedCostCents: number;
}

/**
 * Collapse a list of per-(workspace,user,month) rows into a single totals
 * object. Used by the billing UI to render a workspace-wide summary for
 * the current month.
 */
export function sumOperatorUsage(
  rows: OperatorUsageRecord[]
): OperatorUsageTotals {
  const totals: OperatorUsageTotals = {
    runCount: 0,
    toolCallCount: 0,
    inputTokenCount: 0,
    outputTokenCount: 0,
    estimatedCostCents: 0,
  };
  for (const r of rows) {
    totals.runCount += r.runCount;
    totals.toolCallCount += r.toolCallCount;
    totals.inputTokenCount += r.inputTokenCount;
    totals.outputTokenCount += r.outputTokenCount;
    totals.estimatedCostCents += r.estimatedCostCents;
  }
  return totals;
}
