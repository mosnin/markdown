import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Tool-call approvals — the human-in-the-loop gate for write tools.
 *
 * When a run is configured with `requires_approval` (persona flag, per-run
 * override, or a tool marked as dangerous), every invocation of a gated
 * tool parks a row here in `pending` state. The UI surfaces the pending
 * approvals; a workspace member approves / rejects / edits the args and
 * the agent picks up the resolution at the next polling boundary.
 *
 * Status transitions (enforced at the application layer):
 *
 *   pending  ─approve──▶  approved    (optionally with edited resolved_args)
 *   pending  ─reject───▶  rejected    (with a reject_reason)
 *   pending  ─expire───▶  timed_out   (swept by {@link expireStaleApprovals})
 *
 * Once a row leaves `pending` it is immutable — {@link resolveApproval}
 * gates the UPDATE on `status = 'pending'` so a double-resolution loses
 * instead of silently overwriting the first decision.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToolCallApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "timed_out";

export interface ToolCallApprovalRow {
  id: string;
  run_id: string;
  workspace_id: string;
  tool_call_id: string;
  tool_name: string;
  requested_args: unknown;
  preview: unknown | null;
  status: ToolCallApprovalStatus;
  resolved_args: unknown | null;
  resolved_by: string | null;
  reject_reason: string | null;
  timeout_at: string | null;
  requested_at: string;
  resolved_at: string | null;
}

export interface RequestApprovalInput {
  runId: string;
  workspaceId: string;
  toolCallId: string;
  toolName: string;
  requestedArgs: unknown;
  preview?: unknown;
  /** ISO-8601 timestamp. When set, the sweeper may auto-expire this row. */
  timeoutAt?: string | null;
}

export interface ResolveApprovalInput {
  status: "approved" | "rejected" | "timed_out";
  /**
   * Optional edited args the user wants the tool to run with. When
   * omitted on approval the agent should fall back to `requested_args`.
   */
  resolvedArgs?: unknown;
  /** User UUID that resolved the approval. NULL for system expirations. */
  resolvedBy?: string | null;
  /** Required for `rejected`; ignored for other statuses. */
  rejectReason?: string | null;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Park a new pending approval for a tool call. The `(run_id, tool_call_id)`
 * pair is unique — re-requesting the same tool call will fail at the DB
 * level rather than creating a duplicate row.
 */
export async function requestApproval(
  supabase: SupabaseClient,
  input: RequestApprovalInput
): Promise<ToolCallApprovalRow> {
  const insertPayload: Record<string, unknown> = {
    run_id: input.runId,
    workspace_id: input.workspaceId,
    tool_call_id: input.toolCallId,
    tool_name: input.toolName,
    requested_args: input.requestedArgs,
    status: "pending",
  };
  if (input.preview !== undefined) insertPayload.preview = input.preview;
  if (input.timeoutAt !== undefined) insertPayload.timeout_at = input.timeoutAt;

  const { data, error } = await supabase
    .from("tool_call_approvals")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to request tool-call approval: ${error?.message ?? "unknown"}`
    );
  }
  return data as ToolCallApprovalRow;
}

/**
 * Look up the approval row for a specific tool call within a run. Returns
 * null if no row matches (or RLS hides it).
 */
export async function getApprovalByToolCallId(
  supabase: SupabaseClient,
  runId: string,
  toolCallId: string
): Promise<ToolCallApprovalRow | null> {
  const { data, error } = await supabase
    .from("tool_call_approvals")
    .select("*")
    .eq("run_id", runId)
    .eq("tool_call_id", toolCallId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load tool-call approval: ${error.message}`);
  }
  return (data ?? null) as ToolCallApprovalRow | null;
}

/**
 * Fetch an approval row by its primary id, or null if no row matches.
 */
export async function getApprovalById(
  supabase: SupabaseClient,
  approvalId: string
): Promise<ToolCallApprovalRow | null> {
  const { data, error } = await supabase
    .from("tool_call_approvals")
    .select("*")
    .eq("id", approvalId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load tool-call approval: ${error.message}`);
  }
  return (data ?? null) as ToolCallApprovalRow | null;
}

/**
 * Transition a pending approval to a terminal state.
 *
 * The UPDATE is gated on `status = 'pending'` so that a concurrent
 * resolution (e.g. user approves + sweeper times out in the same tick)
 * results in exactly one winner — the loser gets a "not found" back and
 * we surface that as an explicit error so the caller can refetch.
 */
export async function resolveApproval(
  supabase: SupabaseClient,
  approvalId: string,
  input: ResolveApprovalInput
): Promise<ToolCallApprovalRow> {
  const update: Record<string, unknown> = {
    status: input.status,
    resolved_at: new Date().toISOString(),
  };
  if (input.resolvedArgs !== undefined) update.resolved_args = input.resolvedArgs;
  if (input.resolvedBy !== undefined) update.resolved_by = input.resolvedBy;
  if (input.rejectReason !== undefined)
    update.reject_reason = input.rejectReason;

  const { data, error } = await supabase
    .from("tool_call_approvals")
    .update(update)
    .eq("id", approvalId)
    .eq("status", "pending")
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to resolve tool-call approval (already resolved or not found): ${error?.message ?? "unknown"}`
    );
  }
  return data as ToolCallApprovalRow;
}

/**
 * List all pending approvals for a run, ordered by request time. Used by
 * the run-detail UI to render the "awaiting your approval" queue.
 */
export async function listPendingForRun(
  supabase: SupabaseClient,
  runId: string
): Promise<ToolCallApprovalRow[]> {
  const { data, error } = await supabase
    .from("tool_call_approvals")
    .select("*")
    .eq("run_id", runId)
    .eq("status", "pending")
    .order("requested_at", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list pending approvals for run: ${error.message}`
    );
  }
  return (data ?? []) as ToolCallApprovalRow[];
}

/**
 * List pending approvals across a whole workspace, newest first. Drives
 * the workspace-level "inbox" view.
 */
export async function listPendingForWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
  limit: number = 50
): Promise<ToolCallApprovalRow[]> {
  const capped = Math.max(1, Math.min(limit, 200));

  const { data, error } = await supabase
    .from("tool_call_approvals")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .order("requested_at", { ascending: false })
    .limit(capped);

  if (error) {
    throw new Error(
      `Failed to list pending approvals for workspace: ${error.message}`
    );
  }
  return (data ?? []) as ToolCallApprovalRow[];
}

/**
 * Sweep any pending approvals whose `timeout_at` is before `cutoff`,
 * marking them as `timed_out`. Returns the number of rows flipped. Safe
 * to call repeatedly; it only touches still-pending rows.
 */
export async function expireStaleApprovals(
  supabase: SupabaseClient,
  cutoff: Date
): Promise<number> {
  const cutoffIso = cutoff.toISOString();

  const { data, error } = await supabase
    .from("tool_call_approvals")
    .update({
      status: "timed_out",
      resolved_at: cutoffIso,
    })
    .eq("status", "pending")
    .lt("timeout_at", cutoffIso)
    .select("id");

  if (error) {
    throw new Error(`Failed to expire stale approvals: ${error.message}`);
  }
  return (data ?? []).length;
}
