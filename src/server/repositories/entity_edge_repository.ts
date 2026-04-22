import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntityEdge, EntityEdgeInput } from "@/server/domain/types/entity_edge";

export async function createEdge(supabase: SupabaseClient, input: EntityEdgeInput): Promise<EntityEdge> {
  const { data, error } = await supabase
    .from("entity_edges")
    .insert({
      workspace_id: input.workspace_id,
      source_entity_id: input.source_entity_id,
      target_entity_id: input.target_entity_id,
      edge_type: input.edge_type,
      confidence: input.confidence ?? 1.0,
      note_id: input.note_id ?? null,
      context: input.context ?? null,
    })
    .select("*")
    .single();
  if (error) {
    // Duplicates (same source/target/type/note) are silently ignored
    if (error.code === "23505") {
      return {
        id: "duplicate",
        workspace_id: input.workspace_id,
        source_entity_id: input.source_entity_id,
        target_entity_id: input.target_entity_id,
        edge_type: input.edge_type,
        confidence: input.confidence ?? 1.0,
        note_id: input.note_id ?? null,
        context: input.context ?? null,
        created_at: new Date().toISOString(),
      } as EntityEdge;
    }
    throw error;
  }
  return data as EntityEdge;
}

export async function listEdgesForEntity(
  supabase: SupabaseClient,
  entityId: string
): Promise<EntityEdge[]> {
  const { data, error } = await supabase
    .from("entity_edges")
    .select("*")
    .or(`source_entity_id.eq.${entityId},target_entity_id.eq.${entityId}`);
  if (error) throw error;
  return (data ?? []) as EntityEdge[];
}

export async function listEdgesByWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { limit?: number } = {}
): Promise<EntityEdge[]> {
  let q = supabase.from("entity_edges").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EntityEdge[];
}

export async function deleteEdgesForNote(
  supabase: SupabaseClient,
  noteId: string
): Promise<void> {
  const { error } = await supabase.from("entity_edges").delete().eq("note_id", noteId);
  if (error) throw error;
}
