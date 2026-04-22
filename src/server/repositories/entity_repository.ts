import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entity, EntityInput, EntityType } from "@/server/domain/types/entity";

export async function createEntity(supabase: SupabaseClient, input: EntityInput): Promise<Entity> {
  const { data, error } = await supabase
    .from("entities")
    .insert({
      workspace_id: input.workspace_id,
      name: input.name,
      entity_type: input.entity_type,
      description: input.description ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Entity;
}

export async function findEntityByName(
  supabase: SupabaseClient,
  workspaceId: string,
  name: string,
  entityType: EntityType
): Promise<Entity | null> {
  const { data, error } = await supabase
    .from("entities")
    .select("*")
    .eq("workspace_id", workspaceId)
    .ilike("name", name)
    .eq("entity_type", entityType)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Entity) ?? null;
}

export async function incrementMentionCount(
  supabase: SupabaseClient,
  entityId: string
): Promise<void> {
  const { data: current, error: readErr } = await supabase
    .from("entities")
    .select("mention_count")
    .eq("id", entityId)
    .single();
  if (readErr) throw readErr;
  const nextCount = (current?.mention_count ?? 0) + 1;
  const { error } = await supabase
    .from("entities")
    .update({ mention_count: nextCount, last_seen_at: new Date().toISOString() })
    .eq("id", entityId);
  if (error) throw error;
}

export async function listEntitiesByWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { limit?: number; entityType?: EntityType } = {}
): Promise<Entity[]> {
  let q = supabase
    .from("entities")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("mention_count", { ascending: false })
    .order("last_seen_at", { ascending: false });
  if (opts.entityType) q = q.eq("entity_type", opts.entityType);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Entity[];
}

export async function getEntityById(supabase: SupabaseClient, id: string): Promise<Entity | null> {
  const { data, error } = await supabase.from("entities").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Entity) ?? null;
}
