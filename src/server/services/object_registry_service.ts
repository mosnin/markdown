import { type SupabaseClient } from "@supabase/supabase-js";
import { type WorkspaceObject } from "@/server/domain/types/workspace_object";
import { type ObjectType, type ObjectStatus } from "@/server/domain/constants/object_constants";
import {
  registerWorkspaceObject,
  getWorkspaceObject,
  listWorkspaceObjectsByBox,
  listReusableObjects,
  updateWorkspaceObjectStatus,
  updateWorkspaceObjectDisplayName,
} from "@/server/repositories/workspace_object_repository";

/**
 * Object registry service.
 *
 * Manages the workspace_objects table — the shared structural index for all
 * content objects (notes, files, skills, agents, folders).
 *
 * The registry is NOT the source of truth for object content — that lives in
 * the core tables. The registry is the canonical source for:
 *   - Tree placement (box + folder assignment, sort_order)
 *   - Cross-object indexing (search, graph, overview participation)
 *   - Permission targeting
 *   - Audit targeting
 *
 * Every service that creates a content object must call registerObject.
 * Every service that changes an object's status or name must call the
 * corresponding sync helper.
 */

// ─── Registration ──────────────────────────────────────────────────────────────

/**
 * Register a newly created content object in the shared structural registry.
 * Called by file_service, skill_service, agent_service after object creation.
 */
export async function registerObject(
  supabase: SupabaseClient,
  {
    workspaceId,
    boxId,
    folderId,
    objectType,
    objectId,
    displayName,
    isReusable = false,
  }: {
    workspaceId: string;
    boxId?: string | null;
    folderId?: string | null;
    objectType: ObjectType;
    objectId: string;
    displayName: string;
    isReusable?: boolean;
  }
): Promise<WorkspaceObject> {
  return registerWorkspaceObject(supabase, {
    workspace_id: workspaceId,
    box_id: boxId ?? null,
    folder_id: folderId ?? null,
    object_type: objectType,
    object_id: objectId,
    display_name: displayName,
    is_reusable: isReusable,
  });
}

// ─── Sync helpers ──────────────────────────────────────────────────────────────

/**
 * Sync the registry status when a core object's lifecycle state changes.
 * Called by lifecycle transitions (archive, trash, restore).
 */
export async function syncObjectStatus(
  supabase: SupabaseClient,
  objectType: ObjectType,
  objectId: string,
  newStatus: ObjectStatus
): Promise<void> {
  await updateWorkspaceObjectStatus(supabase, objectType, objectId, newStatus);
}

/**
 * Sync the registry display_name when an object's name/title changes.
 * Called after any rename operation in the core object tables.
 */
export async function syncObjectDisplayName(
  supabase: SupabaseClient,
  objectType: ObjectType,
  objectId: string,
  newDisplayName: string
): Promise<void> {
  await updateWorkspaceObjectDisplayName(supabase, objectType, objectId, newDisplayName);
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch the registry entry for a single object.
 */
export async function getRegistryEntry(
  supabase: SupabaseClient,
  objectType: ObjectType,
  objectId: string
): Promise<WorkspaceObject | null> {
  return getWorkspaceObject(supabase, objectType, objectId);
}

/**
 * List all objects in a box/folder for tree rendering (all types combined).
 * Used as groundwork for a heterogeneous box tree in a future UI prompt.
 */
export async function listBoxContents(
  supabase: SupabaseClient,
  boxId: string,
  opts: { folderId?: string | null; includeArchived?: boolean } = {}
): Promise<WorkspaceObject[]> {
  return listWorkspaceObjectsByBox(supabase, boxId, opts);
}

/**
 * List all workspace-level reusable objects (skills and agents with is_reusable = true).
 * Optionally filtered to a specific object_type ('skill' or 'agent').
 */
export async function listReusablePool(
  supabase: SupabaseClient,
  workspaceId: string,
  objectType?: ObjectType
): Promise<WorkspaceObject[]> {
  return listReusableObjects(supabase, workspaceId, objectType);
}
