import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CitationSourceType,
  WebCitation,
} from "@/server/domain/types/web_tool";

export async function createCitation(
  supabase: SupabaseClient,
  input: {
    workspace_id: string;
    operator_run_id?: string | null;
    source_type: CitationSourceType;
    url: string;
    title?: string | null;
    excerpt?: string | null;
  }
): Promise<WebCitation> {
  const { data, error } = await supabase
    .from("web_citations")
    .insert({
      workspace_id: input.workspace_id,
      operator_run_id: input.operator_run_id ?? null,
      source_type: input.source_type,
      url: input.url,
      title: input.title ?? null,
      excerpt: input.excerpt ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as WebCitation;
}

export async function listCitationsByRun(
  supabase: SupabaseClient,
  operatorRunId: string
): Promise<WebCitation[]> {
  const { data, error } = await supabase
    .from("web_citations")
    .select("*")
    .eq("operator_run_id", operatorRunId)
    .order("fetched_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as WebCitation[];
}
