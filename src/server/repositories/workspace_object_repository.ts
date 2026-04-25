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
import { RepositoryError } from "@/server/domain/errors";

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
 *
 * Branch-aware: when `branchId` is supplied, every row is overlaid
 * with its per-branch placement override (sort_order, folder_id) via
 * `applyPlacementOverridesToList` before the folder filter runs. The
 * overlay is loaded once per call and keyed by `workspace_objects.id`
 * so readers see a branch-local view without canonical mutation.
 * Main readers (no branchId) never touch the overrides table.
 */
export async function listWorkspaceObjectsByBox(
  supabase: SupabaseClient,
  box_id: string,
  {
    folder_id,
    includeArchived = false,
    branchId = null,
  }: {
    folder_id?: string | null;
    includeArchived?: boolean;
    /**
     * Branch context for the read:
     *   - null → main-only view (no placement overlay applied)
     *   - uuid → overlay the given branch's placement overrides
     */
    branchId?: string | null;
  } = {}
): Promise<WorkspaceObject[]> {
  // When a branch is active, defer the folder_id filter to the
  // post-overlay step so rows moved into / out of the target folder
  // via the overlay still resolve correctly.
  let query = supabase
    .from("workspace_objects")
    .select("*")
    .eq("box_id", box_id)
    .neq("status", OBJECT_STATUS.TRASHED);

  if (!includeArchived) {
    query = query.neq("status", OBJECT_STATUS.ARCHIVED);
  }

  if (!branchId && folder_id !== undefined) {
    if (folder_id === null) {
      query = query.is("folder_id", null);
    } else {
      query = query.eq("folder_id", folder_id);
    }
  }

  // Deterministic ordering — sort_order is primary, created_at breaks
  // ties so identical sort_order values never flicker between requests.
  // The branch-overlay path below does its own post-overlay sort
  // (sort_order only, since it's after an in-memory merge); this main
  // query's ordering still feeds the overlay with a stable baseline.
  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  let rows = data as WorkspaceObject[];

  if (branchId) {
    const {
      applyPlacementOverridesToList,
      listPlacementOverridesForBox,
    } = await import("@/server/services/placement_branch_service");
    const overrides = await listPlacementOverridesForBox(
      supabase,
      branchId,
      box_id
    );
    const map = new Map<string, (typeof overrides)[number]>();
    for (const ov of overrides) {
      if (ov.target_type !== "workspace_object") continue;
      map.set(ov.target_id, ov);
    }
    rows = applyPlacementOverridesToList(rows, (r) => r.id, map);

    if (folder_id !== undefined) {
      rows = rows.filter((r) =>
        folder_id === null ? r.folder_id === null : r.folder_id === folder_id
      );
    }

    // Re-sort after overlay so sort_order overrides take effect.
    rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  return rows;
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

  // display_name is the natural lexical sort; created_at secondary so
  // rows with identical display_name have a stable deterministic order.
  const { data, error } = await query
    .order("display_name", { ascending: true })
    .order("created_at", { ascending: true });

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

  if (error || !data) throw new RepositoryError("registerWorkspaceObject", error);
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

  if (error) throw new RepositoryError("updateWorkspaceObjectStatus", error);
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

  if (error) throw new RepositoryError("updateWorkspaceObjectDisplayName", error);
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

  if (error) throw new RepositoryError("deleteWorkspaceObject", error);
}
