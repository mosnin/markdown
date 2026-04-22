import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AgentTriggerRun,
} from "@/server/domain/types/agent_trigger_run";

export async function createTriggerRun(
  supabase: SupabaseClient,
  input: {
    workspace_id: string;
    trigger_id: string;
    agent_id: string;
  }
): Promise<AgentTriggerRun> {
  const { data, error } = await supabase
    .from("agent_trigger_runs")
    .insert({
      workspace_id: input.workspace_id,
      trigger_id: input.trigger_id,
      agent_id: input.agent_id,
      status: "running",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as AgentTriggerRun;
}

export async function updateTriggerRun(
  supabase: SupabaseClient,
  runId: string,
  patch: Partial<
    Pick<
      AgentTriggerRun,
      "status" | "completed_at" | "error" | "skip_reason" | "workspace_operator_run_id"
    >
  >
): Promise<void> {
  const { error } = await supabase
    .from("agent_trigger_runs")
    .update(patch)
    .eq("id", runId);
  if (error) throw error;
}

export async function listRunsByTrigger(
  supabase: SupabaseClient,
  triggerId: string,
  opts: { limit?: number } = {}
): Promise<AgentTriggerRun[]> {
  let q = supabase
    .from("agent_trigger_runs")
    .select("*")
    .eq("trigger_id", triggerId)
    .order("started_at", { ascending: false });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AgentTriggerRun[];
}

export async function findRecentRunningRun(
  supabase: SupabaseClient,
  triggerId: string,
  withinMs: number = 5 * 60 * 1000
): Promise<AgentTriggerRun | null> {
  const cutoff = new Date(Date.now() - withinMs).toISOString();
  const { data, error } = await supabase
    .from("agent_trigger_runs")
    .select("*")
    .eq("trigger_id", triggerId)
    .eq("status", "running")
    .gte("started_at", cutoff)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as AgentTriggerRun) ?? null;
}

export async function getRunSummaryForTrigger(
  supabase: SupabaseClient,
  triggerId: string,
  opts: { limit?: number } = {}
): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  lastRun: AgentTriggerRun | null;
}> {
  const limit = opts.limit ?? 50;
  const runs = await listRunsByTrigger(supabase, triggerId, { limit });
  const total = runs.length;
  const succeeded = runs.filter((r) => r.status === "completed").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  return { total, succeeded, failed, lastRun: runs[0] ?? null };
}
