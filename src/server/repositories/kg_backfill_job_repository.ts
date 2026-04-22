import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  KgBackfillJob,
  KgBackfillJobStatus,
} from "@/server/domain/types/kg_backfill_job";

export async function createBackfillJob(
  supabase: SupabaseClient,
  workspaceId: string,
  triggeredBy: string,
  totalNotes: number
): Promise<KgBackfillJob> {
  const { data, error } = await supabase
    .from("kg_backfill_jobs")
    .insert({
      workspace_id: workspaceId,
      triggered_by: triggeredBy,
      status: "pending" satisfies KgBackfillJobStatus,
      total_notes: totalNotes,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as KgBackfillJob;
}

export async function updateBackfillJob(
  supabase: SupabaseClient,
  jobId: string,
  patch: Partial<
    Pick<
      KgBackfillJob,
      | "status"
      | "processed_notes"
      | "failed_notes"
      | "started_at"
      | "completed_at"
      | "error"
    >
  >
): Promise<void> {
  const { error } = await supabase
    .from("kg_backfill_jobs")
    .update(patch)
    .eq("id", jobId);
  if (error) throw error;
}

export async function getLatestBackfillJob(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<KgBackfillJob | null> {
  const { data, error } = await supabase
    .from("kg_backfill_jobs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as KgBackfillJob) ?? null;
}
