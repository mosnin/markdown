import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntityMention, EntityMentionInput } from "@/server/domain/types/entity_mention";

export async function createMention(
  supabase: SupabaseClient,
  input: EntityMentionInput
): Promise<EntityMention> {
  const { data, error } = await supabase
    .from("entity_mentions")
    .insert({
      workspace_id: input.workspace_id,
      entity_id: input.entity_id,
      note_id: input.note_id,
      surface_form: input.surface_form,
      context: input.context ?? null,
      position_start: input.position_start ?? null,
      position_end: input.position_end ?? null,
      branch_id: input.branch_id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as EntityMention;
}

export async function listMentionsByNote(
  supabase: SupabaseClient,
  noteId: string
): Promise<EntityMention[]> {
  const { data, error } = await supabase
    .from("entity_mentions")
    .select("*")
    .eq("note_id", noteId)
    .order("position_start", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as EntityMention[];
}

export async function listMentionsByEntity(
  supabase: SupabaseClient,
  entityId: string,
  opts: { limit?: number } = {}
): Promise<EntityMention[]> {
  let q = supabase
    .from("entity_mentions")
    .select("*")
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EntityMention[];
}

export async function deleteMentionsForNote(
  supabase: SupabaseClient,
  noteId: string
): Promise<void> {
  const { error } = await supabase.from("entity_mentions").delete().eq("note_id", noteId);
  if (error) throw error;
}
