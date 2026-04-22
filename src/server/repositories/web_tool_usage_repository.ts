import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  WebToolUsage,
  WebToolUsageInput,
} from "@/server/domain/types/web_tool";

export async function recordWebToolUsage(
  supabase: SupabaseClient,
  input: WebToolUsageInput
): Promise<WebToolUsage> {
  const { data, error } = await supabase
    .from("web_tool_usage")
    .insert({
      workspace_id: input.workspace_id,
      user_id: input.user_id ?? null,
      tool_name: input.tool_name,
      units: input.units ?? 1,
      cost_cents: input.cost_cents,
      operator_run_id: input.operator_run_id ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as WebToolUsage;
}

export async function getCurrentMonthSpendCents(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<number> {
  const now = new Date();
  const firstOfMonthIso = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();

  const { data, error } = await supabase
    .from("web_tool_usage")
    .select("cost_cents")
    .eq("workspace_id", workspaceId)
    .gte("created_at", firstOfMonthIso);
  if (error) throw error;

  const rows = (data ?? []) as Array<Pick<WebToolUsage, "cost_cents">>;
  return rows.reduce((sum, r) => sum + (r.cost_cents ?? 0), 0);
}

export async function listRecentUsage(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { limit?: number } = {}
): Promise<WebToolUsage[]> {
  let q = supabase
    .from("web_tool_usage")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as WebToolUsage[];
}
