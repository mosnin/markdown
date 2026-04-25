/**
 * Object version repository.
 *
 * Design notes:
 * - ObjectVersions are immutable — INSERT only, no UPDATE or DELETE.
 * - version_number is assigned by the caller (service responsibility).
 * - After creating a version, callers should call updateFile/updateSkill/updateAgent
 *   to set current_version_id on the parent object row.
 * - Notes use note_versions (separate table); files, skills, and agents use this
 *   shared object_versions table.
 * - object_type + object_id forms the polymorphic pointer to the owning row.
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { type ObjectVersion } from "@/server/domain/types/object_version";
import { type ActorType, type ChangeOrigin } from "@/server/domain/constants/audit_constants";
import { RepositoryError } from "@/server/domain/errors";

/** Input shape for creating a new object version snapshot. */
export interface CreateObjectVersionInput {
  object_type: "file" | "skill" | "agent";
  object_id: string;
  parent_version_id?: string | null;
  version_number: number;
  source_content: string;
  content_bytes: number;
  actor_type: ActorType;
  actor_id: string;
  change_origin: ChangeOrigin;
  diff_summary?: Record<string, unknown> | null;
}

/**
 * Fetch a single object version by its primary key.
 * Returns null if not found or on error.
 */
export async function getObjectVersionById(
  supabase: SupabaseClient,
  id: string
): Promise<ObjectVersion | null> {
  const { data, error } = await supabase
    .from("object_versions")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as ObjectVersion;
}

/**
 * Fetch the most recent version for a given object (by version_number descending).
 * Returns null if no versions exist or on error.
 */
export async function getLatestObjectVersion(
  supabase: SupabaseClient,
  object_type: "file" | "skill" | "agent",
  object_id: string
): Promise<ObjectVersion | null> {
  const { data, error } = await supabase
    .from("object_versions")
    .select("*")
    .eq("object_type", object_type)
    .eq("object_id", object_id)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as ObjectVersion;
}

/**
 * List versions for a given object, ordered by version_number descending (newest first).
 * Defaults to returning the 50 most recent versions.
 */
export async function listObjectVersions(
  supabase: SupabaseClient,
  object_type: "file" | "skill" | "agent",
  object_id: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<ObjectVersion[]> {
  const { data, error } = await supabase
    .from("object_versions")
    .select("*")
    .eq("object_type", object_type)
    .eq("object_id", object_id)
    .order("version_number", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error || !data) return [];
  return data as ObjectVersion[];
}

/**
 * Fetch a specific version by its version_number for the given object.
 * Returns null if not found or on error.
 */
export async function getObjectVersionByNumber(
  supabase: SupabaseClient,
  object_type: "file" | "skill" | "agent",
  object_id: string,
  version_number: number
): Promise<ObjectVersion | null> {
  const { data, error } = await supabase
    .from("object_versions")
    .select("*")
    .eq("object_type", object_type)
    .eq("object_id", object_id)
    .eq("version_number", version_number)
    .single();

  if (error || !data) return null;
  return data as ObjectVersion;
}

/**
 * Fetch a specific version by its id, verifying it belongs to the given object.
 * Analogous to note_version_repository.getVersionByNoteAndId.
 * Returns null if not found or if the version belongs to a different object.
 */
export async function getObjectVersionByObjectAndId(
  supabase: SupabaseClient,
  object_type: "file" | "skill" | "agent",
  object_id: string,
  version_id: string
): Promise<ObjectVersion | null> {
  const { data, error } = await supabase
    .from("object_versions")
    .select("*")
    .eq("id", version_id)
    .eq("object_type", object_type)
    .eq("object_id", object_id)
    .single();

  if (error || !data) return null;
  return data as ObjectVersion;
}

/**
 * Insert a new immutable version snapshot.
 * Throws on database error.
 */
export async function createObjectVersion(
  supabase: SupabaseClient,
  input: CreateObjectVersionInput
): Promise<ObjectVersion> {
  const { data, error } = await supabase
    .from("object_versions")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new RepositoryError("createObjectVersion", error);
  return data as ObjectVersion;
}
