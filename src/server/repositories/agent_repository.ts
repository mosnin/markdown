/**
 * Agent repository.
 *
 * Design notes:
 * - path_cache is written by the caller; this repository does not compute it.
 * - content_bytes should be set to the byte length of source_content before
 *   calling createAgent or updateAgent (service responsibility).
 * - current_version_id is updated via updateAgent after a version is created.
 * - Agents share version history with files/skills via object_versions, not note_versions.
 * - Reusable agents (is_reusable = true) may have box_id = null and are attached
 *   into specific boxes via box_object_attachments.
 * - External writes to workspace-level reusable agents must be proposals only.
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { type Agent } from "@/server/domain/types/agent";
import {
  type CreateAgentInput,
  type UpdateAgentInput,
} from "@/server/domain/schemas/agent_schemas";
import { OBJECT_STATUS } from "@/server/domain/constants/object_constants";

/**
 * Fetch a single agent by its primary key.
 * Returns null if not found or on error.
 */
export async function getAgentById(
  supabase: SupabaseClient,
  id: string
): Promise<Agent | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as Agent;
}

/**
 * List agents in a box with optional folder scoping.
 * Excludes trashed agents. Pass includeArchived = true to include archived agents.
 * Pass folder_id = null to scope to the box root; omit it to return all folders.
 *
 * Branch-aware: when `branchId` is supplied, the query returns main
 * rows (branch_id IS NULL) plus rows whose branch_id matches, and the
 * `branch_pending_ops` trash overlay is applied so agents soft-trashed
 * on the branch disappear from the live listing. Mirrors listNotesByBox.
 */
export async function listAgentsByBox(
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
): Promise<Agent[]> {
  let query = supabase
    .from("agents")
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

  if (branchId && (data as Agent[]).length > 0) {
    const { getHiddenByPendingOps } = await import(
      "@/server/services/pending_op_service"
    );
    const hidden = await getHiddenByPendingOps(supabase, branchId);
    return (data as Agent[]).filter((a) => !hidden.has(`agent:${a.id}`));
  }

  return data as Agent[];
}

/**
 * List all workspace-level reusable agents (is_reusable = true) for a workspace.
 * Excludes trashed agents. Results are ordered alphabetically by name.
 */
export async function listReusableAgents(
  supabase: SupabaseClient,
  workspace_id: string
): Promise<Agent[]> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("workspace_id", workspace_id)
    .eq("is_reusable", true)
    .neq("status", OBJECT_STATUS.TRASHED)
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data as Agent[];
}

/**
 * Insert a new agent row.
 * The caller must supply content_bytes (byte length of source_content).
 * Throws on database error.
 */
export async function createAgent(
  supabase: SupabaseClient,
  input: CreateAgentInput & { content_bytes: number }
): Promise<Agent> {
  const { data, error } = await supabase
    .from("agents")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create agent");
  return data as Agent;
}

/**
 * Update an agent row by id.
 * The caller may supply content_bytes if source_content is being updated.
 * Returns null if the row is not found or an error occurs.
 */
export async function updateAgent(
  supabase: SupabaseClient,
  id: string,
  input: UpdateAgentInput & { content_bytes?: number; path_cache?: string }
): Promise<Agent | null> {
  const { data, error } = await supabase
    .from("agents")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) return null;
  return data as Agent;
}

/**
 * Bulk-fetch agents by id.
 * Returns an empty array when ids is empty.
 * Used for bundle assembly and export preparation.
 */
export async function getAgentsByIds(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Agent[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .in("id", ids);

  if (error || !data) return [];
  return data as Agent[];
}
