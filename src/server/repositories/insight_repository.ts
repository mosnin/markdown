import type { SupabaseClient } from "@supabase/supabase-js";
import type { Insight, InsightCategory, InsightInput } from "@/server/domain/types/insight";

export async function createInsight(supabase: SupabaseClient, input: InsightInput): Promise<Insight> {
  const { data, error } = await supabase
    .from("insights")
    .insert({
      workspace_id: input.workspace_id,
      note_id: input.note_id,
      claim: input.claim,
      category: input.category,
      confidence: input.confidence ?? 1.0,
      source_excerpt: input.source_excerpt ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Insight;
}

export async function listInsightsByWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { category?: InsightCategory; limit?: number } = {}
): Promise<Insight[]> {
  let q = supabase
    .from("insights")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (opts.category) q = q.eq("category", opts.category);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Insight[];
}

export async function listInsightsByNote(supabase: SupabaseClient, noteId: string): Promise<Insight[]> {
  const { data, error } = await supabase.from("insights").select("*").eq("note_id", noteId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Insight[];
}

export async function deleteInsightsForNote(supabase: SupabaseClient, noteId: string): Promise<void> {
  const { error } = await supabase.from("insights").delete().eq("note_id", noteId);
  if (error) throw error;
}
