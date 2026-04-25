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
import { RepositoryError } from "@/server/domain/errors";
import {
  LINKABLE_OBJECT_TYPES,
  type ObjectType,
} from "@/server/domain/constants/object_constants";

/**
 * Strict UUID v1–v5 shape check. Used to guard any value that is
 * interpolated into a PostgREST `.or()` filter string (which is not
 * parameterised and therefore vulnerable to filter-injection if the
 * input is attacker-controlled).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, name: string): void {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new Error(`Invalid ${name}: expected UUID`);
  }
}

function assertLinkableObjectType(value: string): void {
  if (!(LINKABLE_OBJECT_TYPES as readonly string[]).includes(value)) {
    throw new Error("Invalid object type");
  }
}

/** Input shape for creating a new object link. */
export interface CreateObjectLinkInput {
  workspace_id: string;
  source_object_type: ObjectType;
  source_object_id: string;
  target_object_type: ObjectType;
  target_object_id: string;
  relationship_type: RelationshipType;
  relationship_note?: string | null;
  /**
   * Optional branch ownership. `null` (or omitted) writes a main
   * row; a uuid lands the link on a draft branch. See
   * docs/branch_local_structural_creation_v1.md (v1.10).
   */
  branch_id?: string | null;
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
  // object_type and object_id are interpolated into a PostgREST `.or()`
  // filter string below, which is NOT parameterised. Validate both
  // against strict allowlists to prevent filter-injection.
  assertLinkableObjectType(object_type);
  assertUuid(object_id, "object_id");

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

  if (error || !data) throw new RepositoryError("createObjectLink", error);
  return data as ObjectLink;
}

/**
 * Hard-delete a single object link by its primary key.
 * When `workspace_id` is provided, the delete is additionally scoped
 * to that workspace for defense-in-depth against IDOR — callers in the
 * service layer should always pass it after verifying ownership.
 * Returns true if deleted, false if the row was not found or an error occurred.
 */
export async function deleteObjectLink(
  supabase: SupabaseClient,
  id: string,
  workspace_id?: string
): Promise<boolean> {
  let query = supabase.from("object_links").delete().eq("id", id);
  if (workspace_id) {
    query = query.eq("workspace_id", workspace_id);
  }
  const { error } = await query;

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
