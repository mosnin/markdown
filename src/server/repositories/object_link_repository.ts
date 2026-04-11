/**
 * Object link repository.
 *
 * Design notes:
 * - ObjectLinks are directional: source → target. No UPDATE: links are replaced
 *   by delete + re-insert.
 * - Self-links (same type + same id on both ends) must be rejected at the service layer.
 * - Same-workspace enforcement is the service layer's responsibility (not DB-level
 *   due to the polymorphic pointer design).
 * - This table generalises note_links to all object types. Use object_links whenever
 *   at least one endpoint is a non-note type, or for mixed-type relationships.
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { type ObjectLink } from "@/server/domain/types/object_link";
import { type RelationshipType } from "@/server/domain/constants/note_constants";
import { type ObjectType } from "@/server/domain/constants/object_constants";

/** Input shape for creating a new object link. */
export interface CreateObjectLinkInput {
  workspace_id: string;
  source_object_type: ObjectType;
  source_object_id: string;
  target_object_type: ObjectType;
  target_object_id: string;
  relationship_type: RelationshipType;
  relationship_note?: string | null;
}

/**
 * List all object links where the given object is the source.
 * Results are ordered by creation time ascending.
 */
export async function getObjectLinksForSource(
  supabase: SupabaseClient,
  workspace_id: string,
  source_object_type: ObjectType,
  source_object_id: string
): Promise<ObjectLink[]> {
  const { data, error } = await supabase
    .from("object_links")
    .select("*")
    .eq("workspace_id", workspace_id)
    .eq("source_object_type", source_object_type)
    .eq("source_object_id", source_object_id)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return data as ObjectLink[];
}

/**
 * List all object links where the given object is the target.
 * Results are ordered by creation time ascending.
 */
export async function getObjectLinksForTarget(
  supabase: SupabaseClient,
  workspace_id: string,
  target_object_type: ObjectType,
  target_object_id: string
): Promise<ObjectLink[]> {
  const { data, error } = await supabase
    .from("object_links")
    .select("*")
    .eq("workspace_id", workspace_id)
    .eq("target_object_type", target_object_type)
    .eq("target_object_id", target_object_id)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return data as ObjectLink[];
}

/**
 * List all object links where the given object appears as either source or target.
 * Useful for rendering a full relationship graph for an object.
 * Results are ordered by creation time ascending.
 */
export async function getAllObjectLinksForObject(
  supabase: SupabaseClient,
  workspace_id: string,
  object_type: ObjectType,
  object_id: string
): Promise<ObjectLink[]> {
  const { data, error } = await supabase
    .from("object_links")
    .select("*")
    .eq("workspace_id", workspace_id)
    .or(
      `and(source_object_type.eq.${object_type},source_object_id.eq.${object_id}),` +
      `and(target_object_type.eq.${object_type},target_object_id.eq.${object_id})`
    )
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return data as ObjectLink[];
}

/**
 * Insert a new object link.
 * Throws on database error.
 */
export async function createObjectLink(
  supabase: SupabaseClient,
  input: CreateObjectLinkInput
): Promise<ObjectLink> {
  const { data, error } = await supabase
    .from("object_links")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create object link");
  return data as ObjectLink;
}

/**
 * Hard-delete a single object link by its primary key.
 * Returns true if deleted, false if the row was not found or an error occurred.
 */
export async function deleteObjectLink(
  supabase: SupabaseClient,
  id: string
): Promise<boolean> {
  const { error } = await supabase
    .from("object_links")
    .delete()
    .eq("id", id);

  return !error;
}

/**
 * Hard-delete all object links where the given object appears as source or target.
 * Called when an object is permanently deleted to clean up its graph edges.
 */
export async function deleteObjectLinksForObject(
  supabase: SupabaseClient,
  workspace_id: string,
  object_type: ObjectType,
  object_id: string
): Promise<void> {
  await supabase
    .from("object_links")
    .delete()
    .eq("workspace_id", workspace_id)
    .eq("source_object_type", object_type)
    .eq("source_object_id", object_id);

  await supabase
    .from("object_links")
    .delete()
    .eq("workspace_id", workspace_id)
    .eq("target_object_type", object_type)
    .eq("target_object_id", object_id);
}
