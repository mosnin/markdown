import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Workspace Operator runs — durable record of every Operator invocation.
 *
 * The Workspace Operator (`workspace_operator_service.ts`) is fire-and-forget
 * from the Modal side; this table is the Next.js side's source of truth for
 * what runs were kicked off, what their state is, and what they produced.
 *
 * Status transitions (enforced at the application layer):
 *
 *   queued  ─plan request──▶  planning   ─plan returned──▶  awaiting_approval
 *           ─execute (full)─▶  executing
 *
 *   awaiting_approval ─approve──▶  executing
 *   executing         ─done────▶  completed | failed
 *   any state         ─cancel──▶  cancelled
 *
 * The `plan` jsonb stores the approved plan steps array; `result` stores
 * the OperatorResult payload (notes_created, tool_calls, error). We keep
 * the count columns (`tool_calls`, `notes_created`, `duration_ms`)
 * denormalized so list views can filter / sort without parsing jsonb.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type OperatorRunMode = "plan" | "execute" | "full";

export type OperatorRunStatus =
  | "queued"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

export interface WorkspaceOperatorRunRow {
  id: string;
  workspace_id: string;
  user_id: string;
  branch_id: string | null;
  prompt: string;
  mode: OperatorRunMode;
  status: OperatorRunStatus;
  plan: unknown | null;
  result: unknown | null;
  error: string | null;
  notes_created: string[];
  tool_calls: number;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOperatorRunInput {
  workspaceId: string;
  userId: string;
  branchId?: string | null;
  prompt: string;
  mode: OperatorRunMode;
}

export interface UpdateOperatorRunPatch {
  status?: OperatorRunStatus;
  plan?: unknown;
  result?: unknown;
  error?: string | null;
  notesCreated?: string[];
  toolCalls?: number;
  durationMs?: number | null;
  branchId?: string | null;
}

export interface ListOperatorRunsParams {
  /** Filter to a single workspace. Optional — omit to list across the user's workspaces. */
  workspaceId?: string;
  /** Filter to a single actor. Recommended for the "my runs" history view. */
  userId?: string;
  /** Page size. Defaults to 25, capped at 100. */
  limit?: number;
  /**
   * Opaque pagination cursor. The previous page's `nextCursor` is the
   * `created_at` ISO timestamp of the last row returned; pass it back to
   * continue the descending sort.
   */
  cursor?: string | null;
}

export interface ListOperatorRunsResult {
  rows: WorkspaceOperatorRunRow[];
  /** ISO timestamp of the last row's created_at, or null if no more pages. */
  nextCursor: string | null;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Create a new run row. Status starts at 'queued'; callers advance it to
 * 'planning' / 'executing' before dispatch via {@link updateOperatorRun}.
 */
export async function createOperatorRun(
  supabase: SupabaseClient,
  input: CreateOperatorRunInput
): Promise<WorkspaceOperatorRunRow> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Prompt is required");

  const { data, error } = await supabase
    .from("workspace_operator_runs")
    .insert({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      branch_id: input.branchId ?? null,
      prompt,
      mode: input.mode,
      status: "queued",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create operator run: ${error?.message ?? "unknown"}`);
  }
  return data as WorkspaceOperatorRunRow;
}

/**
 * Apply a partial update to a run row.
 *
 * Only fields explicitly set in `patch` are written. We always bump
 * `updated_at` server-side via the trigger; we don't pass it from JS.
 */
export async function updateOperatorRun(
  supabase: SupabaseClient,
  runId: string,
  patch: UpdateOperatorRunPatch
): Promise<WorkspaceOperatorRunRow> {
  const update: Record<string, unknown> = {};
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.plan !== undefined) update.plan = patch.plan;
  if (patch.result !== undefined) update.result = patch.result;
  if (patch.error !== undefined) update.error = patch.error;
  if (patch.notesCreated !== undefined) update.notes_created = patch.notesCreated;
  if (patch.toolCalls !== undefined) update.tool_calls = patch.toolCalls;
  if (patch.durationMs !== undefined) update.duration_ms = patch.durationMs;
  if (patch.branchId !== undefined) update.branch_id = patch.branchId;

  if (Object.keys(update).length === 0) {
    const existing = await getOperatorRun(supabase, runId);
    if (!existing) throw new Error("Operator run not found");
    return existing;
  }

  const { data, error } = await supabase
    .from("workspace_operator_runs")
    .update(update)
    .eq("id", runId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to update operator run: ${error?.message ?? "unknown"}`);
  }
  return data as WorkspaceOperatorRunRow;
}

/**
 * List runs with descending `created_at` ordering and cursor pagination.
 *
 * Pagination contract:
 *   - rows are ordered newest first
 *   - the cursor passed in is treated as "give me rows older than this"
 *   - the response's `nextCursor` is the oldest row's created_at, or null
 *     when fewer than `limit` rows came back (signalling end-of-stream)
 */
export async function listOperatorRuns(
  supabase: SupabaseClient,
  params: ListOperatorRunsParams = {}
): Promise<ListOperatorRunsResult> {
  const limit = Math.max(1, Math.min(params.limit ?? 25, 100));

  let query = supabase
    .from("workspace_operator_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params.workspaceId) query = query.eq("workspace_id", params.workspaceId);
  if (params.userId) query = query.eq("user_id", params.userId);
  if (params.cursor) query = query.lt("created_at", params.cursor);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list operator runs: ${error.message}`);
  const rows = (data ?? []) as WorkspaceOperatorRunRow[];

  const nextCursor =
    rows.length === limit ? (rows[rows.length - 1]?.created_at ?? null) : null;

  return { rows, nextCursor };
}

/**
 * Fetch a single run by id, or null when no row matches (or when RLS hides
 * it). Service-layer callers never need to distinguish "not found" from
 * "not visible".
 */
export async function getOperatorRun(
  supabase: SupabaseClient,
  runId: string
): Promise<WorkspaceOperatorRunRow | null> {
  const { data, error } = await supabase
    .from("workspace_operator_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load operator run: ${error.message}`);
  return (data ?? null) as WorkspaceOperatorRunRow | null;
}
