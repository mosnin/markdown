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

/**
 * Atomically bump mention_count + last_seen_at via the
 * `increment_entity_mention_count` SQL function (added in migration
 * 20260423000002). Replaces a read-then-write that could lose counts
 * under concurrent note saves.
 */
export async function incrementMentionCount(
  supabase: SupabaseClient,
  entityId: string
): Promise<void> {
  const { error } = await supabase.rpc("increment_entity_mention_count", {
    p_entity_id: entityId,
  });
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
