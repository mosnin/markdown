import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Run plans — structured plan-first documents keyed 1:1 to an operator run.
 *
 * When a persona (or an explicit `plan_first` flag on the run) demands a
 * plan before execution, the agent writes a structured plan document here
 * and pauses the run. A workspace member reviews the plan, optionally edits
 * the `summary` / `steps`, approves it, and the run resumes.
 *
 * Each row mirrors exactly one `workspace_operator_runs.id` (enforced by the
 * `UNIQUE(run_id)` constraint on the table). The agent re-issues the plan
 * via {@link upsertRunPlan} — subsequent plan revisions for the same run
 * overwrite the row rather than appending.
 *
 * The `steps` jsonb column is an ordered array of {@link RunPlanStep}
 * entries; {@link markStepStatus} is the safe way to mutate a single step
 * status without racing a concurrent full-plan overwrite (read-modify-write
 * on the array).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type RunPlanStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "skipped";

export interface RunPlanStep {
  index: number;
  description: string;
  tool: string | null;
  args_sketch?: unknown;
  status: RunPlanStepStatus;
}

export interface RunPlanRow {
  id: string;
  run_id: string;
  workspace_id: string;
  summary: string | null;
  steps: RunPlanStep[];
  approved: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertPlanInput {
  runId: string;
  workspaceId: string;
  summary?: string | null;
  steps: RunPlanStep[];
}

export interface UpdatePlanPatch {
  summary?: string | null;
  steps?: RunPlanStep[];
  approved?: boolean;
  approvedBy?: string | null;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Upsert the plan document for a run. Keyed on `run_id` (UNIQUE), so the
 * agent can re-issue a revised plan for the same run without first having
 * to delete the prior row.
 */
export async function upsertRunPlan(
  supabase: SupabaseClient,
  input: UpsertPlanInput
): Promise<RunPlanRow> {
  const payload: Record<string, unknown> = {
    run_id: input.runId,
    workspace_id: input.workspaceId,
    summary: input.summary ?? null,
    steps: input.steps,
  };

  const { data, error } = await supabase
    .from("run_plans")
    .upsert(payload, { onConflict: "run_id" })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert run plan: ${error?.message ?? "unknown"}`);
  }
  return data as RunPlanRow;
}

/**
 * Fetch the plan for a run by `run_id`, or null when no plan has been
 * written yet (or when RLS hides it).
 */
export async function getRunPlan(
  supabase: SupabaseClient,
  runId: string
): Promise<RunPlanRow | null> {
  const { data, error } = await supabase
    .from("run_plans")
    .select("*")
    .eq("run_id", runId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load run plan: ${error.message}`);
  return (data ?? null) as RunPlanRow | null;
}

/**
 * Apply a partial update to a plan row, addressed by `run_id`. When
 * `patch.approved` is set to true we also stamp `approved_at` with the
 * current ISO timestamp so the caller doesn't have to coordinate the
 * two fields.
 */
export async function updateRunPlan(
  supabase: SupabaseClient,
  runId: string,
  patch: UpdatePlanPatch
): Promise<RunPlanRow> {
  const update: Record<string, unknown> = {};
  if (patch.summary !== undefined) update.summary = patch.summary;
  if (patch.steps !== undefined) update.steps = patch.steps;
  if (patch.approved !== undefined) {
    update.approved = patch.approved;
    if (patch.approved === true) {
      update.approved_at = new Date().toISOString();
    }
  }
  if (patch.approvedBy !== undefined) update.approved_by = patch.approvedBy;

  if (Object.keys(update).length === 0) {
    const existing = await getRunPlan(supabase, runId);
    if (!existing) throw new Error("Run plan not found");
    return existing;
  }

  const { data, error } = await supabase
    .from("run_plans")
    .update(update)
    .eq("run_id", runId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to update run plan: ${error?.message ?? "unknown"}`);
  }
  return data as RunPlanRow;
}

/**
 * Update a single step's `status` in the `steps` array. Reads the current
 * array, mutates the entry at `stepIndex`, and writes it back. Throws when
 * the plan is missing or when `stepIndex` falls outside the array bounds.
 *
 * Callers that need atomicity against a concurrent full-plan overwrite
 * should serialize at a higher level — this function is a best-effort
 * read-modify-write.
 */
export async function markStepStatus(
  supabase: SupabaseClient,
  runId: string,
  stepIndex: number,
  status: RunPlanStepStatus
): Promise<RunPlanRow> {
  const existing = await getRunPlan(supabase, runId);
  if (!existing) throw new Error("Run plan not found");

  const steps = Array.isArray(existing.steps) ? [...existing.steps] : [];
  if (stepIndex < 0 || stepIndex >= steps.length) {
    throw new Error(
      `Step index ${stepIndex} out of bounds (plan has ${steps.length} steps)`
    );
  }

  const current = steps[stepIndex];
  if (!current) {
    throw new Error(`Step index ${stepIndex} is missing from plan`);
  }
  steps[stepIndex] = { ...current, status };

  const { data, error } = await supabase
    .from("run_plans")
    .update({ steps })
    .eq("run_id", runId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to mark step status: ${error?.message ?? "unknown"}`);
  }
  return data as RunPlanRow;
}
