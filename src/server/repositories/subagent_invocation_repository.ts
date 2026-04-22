import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SubagentInvocation,
  SubagentInvocationInput,
  SubagentInvocationUpdate,
  SubagentStatus,
} from "@/server/domain/types/subagent";

export async function createSubagentInvocation(
  supabase: SupabaseClient,
  input: SubagentInvocationInput
): Promise<SubagentInvocation> {
  const { data, error } = await supabase
    .from("subagent_invocations")
    .insert({
      workspace_id: input.workspace_id,
      parent_operator_run_id: input.parent_operator_run_id ?? null,
      skill_id: input.skill_id,
      user_id: input.user_id ?? null,
      task: input.task,
      depth: input.depth ?? 1,
      status: "queued",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as SubagentInvocation;
}

export async function getSubagentInvocationById(
  supabase: SupabaseClient,
  id: string
): Promise<SubagentInvocation | null> {
  const { data, error } = await supabase
    .from("subagent_invocations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as SubagentInvocation) ?? null;
}

export async function updateSubagentInvocation(
  supabase: SupabaseClient,
  id: string,
  patch: SubagentInvocationUpdate
): Promise<void> {
  const { error } = await supabase
    .from("subagent_invocations")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function listInvocationsByParent(
  supabase: SupabaseClient,
  parentOperatorRunId: string
): Promise<SubagentInvocation[]> {
  const { data, error } = await supabase
    .from("subagent_invocations")
    .select("*")
    .eq("parent_operator_run_id", parentOperatorRunId)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SubagentInvocation[];
}

export async function listRecentInvocationsByWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { limit?: number; status?: SubagentStatus } = {}
): Promise<SubagentInvocation[]> {
  let q = supabase
    .from("subagent_invocations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("started_at", { ascending: false });
  if (opts.status) q = q.eq("status", opts.status);
  q = q.limit(opts.limit ?? 50);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SubagentInvocation[];
}
