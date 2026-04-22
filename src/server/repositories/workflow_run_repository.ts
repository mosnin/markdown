import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  WorkflowNodeRun,
  WorkflowNodeRunStatus,
  WorkflowRun,
  WorkflowRunStatus,
} from "@/server/domain/types/workflow";

export interface CreateWorkflowRunInput {
  workflow_id: string;
  workspace_id: string;
  user_id?: string | null;
  input: Record<string, unknown>;
}

export interface UpdateWorkflowRunPatch {
  status?: WorkflowRunStatus;
  output?: Record<string, unknown> | null;
  error?: string | null;
  completed_at?: string;
  total_cost_cents?: number;
}

export interface ListWorkflowRunsOptions {
  limit?: number;
  status?: WorkflowRunStatus;
}

export async function createWorkflowRun(
  supabase: SupabaseClient,
  input: CreateWorkflowRunInput
): Promise<WorkflowRun> {
  const { data, error } = await supabase
    .from("workflow_runs")
    .insert({
      workflow_id: input.workflow_id,
      workspace_id: input.workspace_id,
      user_id: input.user_id ?? null,
      input: input.input,
      status: "queued",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as WorkflowRun;
}

export async function updateWorkflowRun(
  supabase: SupabaseClient,
  id: string,
  patch: UpdateWorkflowRunPatch
): Promise<void> {
  const { error } = await supabase
    .from("workflow_runs")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function getWorkflowRunById(
  supabase: SupabaseClient,
  id: string
): Promise<WorkflowRun | null> {
  const { data, error } = await supabase
    .from("workflow_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as WorkflowRun) ?? null;
}

export async function listWorkflowRunsForWorkflow(
  supabase: SupabaseClient,
  workflowId: string,
  opts: ListWorkflowRunsOptions = {}
): Promise<WorkflowRun[]> {
  let q = supabase
    .from("workflow_runs")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("started_at", { ascending: false });
  if (opts.status) q = q.eq("status", opts.status);
  q = q.limit(opts.limit ?? 50);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as WorkflowRun[];
}

export interface CreateWorkflowNodeRunInput {
  workflow_run_id: string;
  node_id: string;
}

export interface UpdateWorkflowNodeRunPatch {
  status?: WorkflowNodeRunStatus;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
  started_at?: string;
  completed_at?: string;
  subagent_invocation_id?: string | null;
}

export async function createWorkflowNodeRun(
  supabase: SupabaseClient,
  input: CreateWorkflowNodeRunInput
): Promise<WorkflowNodeRun> {
  const { data, error } = await supabase
    .from("workflow_node_runs")
    .insert({
      workflow_run_id: input.workflow_run_id,
      node_id: input.node_id,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as WorkflowNodeRun;
}

export async function updateWorkflowNodeRun(
  supabase: SupabaseClient,
  id: string,
  patch: UpdateWorkflowNodeRunPatch
): Promise<void> {
  const { error } = await supabase
    .from("workflow_node_runs")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function listNodeRunsByRun(
  supabase: SupabaseClient,
  workflowRunId: string
): Promise<WorkflowNodeRun[]> {
  const { data, error } = await supabase
    .from("workflow_node_runs")
    .select("*")
    .eq("workflow_run_id", workflowRunId)
    .order("started_at", { ascending: true, nullsFirst: true });
  if (error) throw error;
  return (data ?? []) as WorkflowNodeRun[];
}
