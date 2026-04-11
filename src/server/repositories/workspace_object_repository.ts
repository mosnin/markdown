/**
 * Workspace object registry repository.
 * Manages the shared structural index for all content objects.
 *
 * Design notes:
 * - Every content object (note, file, skill, agent, folder) has a corresponding
 *   workspace_object row. This is the canonical cross-type structural index.
 * - display_name is denormalized from the core table and kept in sync by the
 *   service layer via updateWorkspaceObjectDisplayName.
 * - Reusable objects (is_reusable = true) may have box_id = null and are attached
 *   into specific boxes via box_object_attachments.
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { type WorkspaceObject } from "@/server/domain/types/workspace_object";
import {
  OBJECT_STATUS,
  type ObjectType,
  type ObjectStatus,
} from "@/server/domain/constants/object_constants";

export interface RegisterWorkspaceObjectInput {
  workspace_id: string;
  box_id?: string | null;
  folder_id?: string | null;
  object_type: ObjectType;
  object_id: string;
  display_name: string;
  sort_order?: number;
  is_reusable?: boolean;
}

/**
 * Fetch a single workspace_object row by its polymorphic pointer (object_type + object_id).
 * Returns null if not found.
 */
export async function getWorkspaceObject(
  supabase: SupabaseClient,
  object_type: ObjectType,
  object_id: string
): Promise<WorkspaceObject | null> {
  const { data, error } = await supabase
    .from("workspace_objects")
    .select("*")
    .eq("object_type", object_type)
    .eq("object_id", object_id)
    .single();

  if (error || !data) return null;
  return data as WorkspaceObject;
}

/**
 * List all workspace_objects belonging to a box.
 * By default excludes archived and trashed entries.
 * Pass folder_id to scope to a specific folder; null scopes to the box root.
 */
export async function listWorkspaceObjectsByBox(
  supabase: SupabaseClient,
  box_id: string,
  {
    folder_id,
    includeArchived = false,
  }: {
    folder_id?: string | null;
    includeArchived?: boolean;
  } = {}
): Promise<WorkspaceObject[]> {
  let query = supabase
    .from("workspace_objects")
    .select("*")
    .eq("box_id", box_id)
    .neq("status", OBJECT_STATUS.TRASHED);

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

  const { data, error } = await query.order("sort_order", { ascending: true });

  if (error || !data) return [];
  return data as WorkspaceObject[];
}

/**
 * List all workspace-level reusable objects (is_reusable = true) for a workspace.
 * Optionally filter by object_type (e.g. 'skill' or 'agent').
 */
export async function listReusableObjects(
  supabase: SupabaseClient,
  workspace_id: string,
  object_type?: ObjectType
): Promise<WorkspaceObject[]> {
  let query = supabase
    .from("workspace_objects")
    .select("*")
    .eq("workspace_id", workspace_id)
    .eq("is_reusable", true)
    .neq("status", OBJECT_STATUS.TRASHED);

  if (object_type !== undefined) {
    query = query.eq("object_type", object_type);
  }

  const { data, error } = await query.order("display_name", { ascending: true });

  if (error || !data) return [];
  return data as WorkspaceObject[];
}

/**
 * Insert a new workspace_object row.
 * Called by the service layer immediately after inserting the core object row.
 */
export async function registerWorkspaceObject(
  supabase: SupabaseClient,
  input: RegisterWorkspaceObjectInput
): Promise<WorkspaceObject> {
  const { data, error } = await supabase
    .from("workspace_objects")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to register workspace object");
  return data as WorkspaceObject;
}

/**
 * Update the status field of a workspace_object row.
 * Used when the corresponding core object is archived, trashed, or restored.
 */
export async function updateWorkspaceObjectStatus(
  supabase: SupabaseClient,
  object_type: ObjectType,
  object_id: string,
  status: ObjectStatus
): Promise<void> {
  const { error } = await supabase
    .from("workspace_objects")
    .update({ status })
    .eq("object_type", object_type)
    .eq("object_id", object_id);

  if (error) throw new Error(error.message);
}

/**
 * Update the denormalized display_name on a workspace_object row.
 * Called by the service layer whenever the owning object's name/title changes.
 */
export async function updateWorkspaceObjectDisplayName(
  supabase: SupabaseClient,
  object_type: ObjectType,
  object_id: string,
  display_name: string
): Promise<void> {
  const { error } = await supabase
    .from("workspace_objects")
    .update({ display_name })
    .eq("object_type", object_type)
    .eq("object_id", object_id);

  if (error) throw new Error(error.message);
}

/**
 * Hard-delete a workspace_object row.
 * Only called when the core object row itself is permanently deleted.
 * For soft-deletion, use updateWorkspaceObjectStatus with OBJECT_STATUS.TRASHED.
 */
export async function deleteWorkspaceObject(
  supabase: SupabaseClient,
  object_type: ObjectType,
  object_id: string
): Promise<void> {
  const { error } = await supabase
    .from("workspace_objects")
    .delete()
    .eq("object_type", object_type)
    .eq("object_id", object_id);

  if (error) throw new Error(error.message);
}
