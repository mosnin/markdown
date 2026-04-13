/**
 * Skill repository.
 *
 * Design notes:
 * - path_cache is written by the caller; this repository does not compute it.
 * - content_bytes should be set to the byte length of source_content before
 *   calling createSkill or updateSkill (service responsibility).
 * - current_version_id is updated via updateSkill after a version is created.
 * - Skills share version history with files/agents via object_versions, not note_versions.
 * - Reusable skills (is_reusable = true) may have box_id = null and are attached
 *   into specific boxes via box_object_attachments.
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { type Skill } from "@/server/domain/types/skill";
import {
  type CreateSkillInput,
  type UpdateSkillInput,
} from "@/server/domain/schemas/skill_schemas";
import { OBJECT_STATUS } from "@/server/domain/constants/object_constants";

/**
 * Fetch a single skill by its primary key.
 * Returns null if not found or on error.
 */
export async function getSkillById(
  supabase: SupabaseClient,
  id: string
): Promise<Skill | null> {
  const { data, error } = await supabase
    .from("skills")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as Skill;
}

/**
 * List skills in a box with optional folder scoping.
 * Excludes trashed skills. Pass includeArchived = true to include archived skills.
 * Pass folder_id = null to scope to the box root; omit it to return all folders.
 *
 * Branch-aware: when `branchId` is supplied, the query returns main
 * rows (branch_id IS NULL) plus rows whose branch_id matches, and the
 * `branch_pending_ops` trash overlay is applied so skills soft-trashed
 * on the branch disappear from the live listing. Mirrors listNotesByBox.
 */
export async function listSkillsByBox(
  supabase: SupabaseClient,
  box_id: string,
  {
    folder_id,
    includeArchived = false,
    branchId = null,
  }: {
    folder_id?: string | null;
    includeArchived?: boolean;
    branchId?: string | null;
  } = {}
): Promise<Skill[]> {
  let query = supabase
    .from("skills")
    .select("*")
    .eq("box_id", box_id)
    .neq("status", OBJECT_STATUS.TRASHED);

  if (branchId) {
    query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  } else {
    query = query.is("branch_id", null);
  }

  if (!includeArchived) {
    query = query.neq("status", OBJECT_STATUS.ARCHIVED);
  }

  // null means root level; undefined means all folders
  if (folder_id !== undefined) {
    if (folder_id === null) {
      query = query.is("folder_id", null);
    } else {
      query = query.eq("folder_id", folder_id);
    }
  }

  const { data, error } = await query.order("name", { ascending: true });

  if (error || !data) return [];

  if (branchId && (data as Skill[]).length > 0) {
    const { getHiddenByPendingOps } = await import(
      "@/server/services/pending_op_service"
    );
    const hidden = await getHiddenByPendingOps(supabase, branchId);
    return (data as Skill[]).filter((s) => !hidden.has(`skill:${s.id}`));
  }

  return data as Skill[];
}

/**
 * List all workspace-level reusable skills (is_reusable = true) for a workspace.
 * Excludes trashed skills. Results are ordered alphabetically by name.
 */
export async function listReusableSkills(
  supabase: SupabaseClient,
  workspace_id: string
): Promise<Skill[]> {
  const { data, error } = await supabase
    .from("skills")
    .select("*")
    .eq("workspace_id", workspace_id)
    .eq("is_reusable", true)
    .neq("status", OBJECT_STATUS.TRASHED)
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data as Skill[];
}

/**
 * Insert a new skill row.
 * The caller must supply content_bytes (byte length of source_content).
 * Throws on database error.
 */
export async function createSkill(
  supabase: SupabaseClient,
  input: CreateSkillInput & { content_bytes: number }
): Promise<Skill> {
  const { data, error } = await supabase
    .from("skills")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create skill");
  return data as Skill;
}

/**
 * Update a skill row by id.
 * The caller may supply content_bytes if source_content is being updated.
 * Returns null if the row is not found or an error occurs.
 */
export async function updateSkill(
  supabase: SupabaseClient,
  id: string,
  input: UpdateSkillInput & { content_bytes?: number; path_cache?: string }
): Promise<Skill | null> {
  const { data, error } = await supabase
    .from("skills")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) return null;
  return data as Skill;
}

/**
 * Bulk-fetch skills by id.
 * Returns an empty array when ids is empty.
 * Used for bundle assembly and export preparation.
 */
export async function getSkillsByIds(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Skill[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("skills")
    .select("*")
    .in("id", ids);

  if (error || !data) return [];
  return data as Skill[];
}
