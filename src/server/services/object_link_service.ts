import { type SupabaseClient } from "@supabase/supabase-js";
import { type ObjectLink } from "@/server/domain/types/object_link";
import { type ObjectType } from "@/server/domain/constants/object_constants";
import { type RelationshipType } from "@/server/domain/constants/note_constants";
import {
  createObjectLink,
  deleteObjectLink,
  getObjectLinksForSource,
  getObjectLinksForTarget,
} from "@/server/repositories/object_link_repository";
import { getWorkspaceObject } from "@/server/repositories/workspace_object_repository";

/**
 * Object link service.
 *
 * Creates and manages semantic relationships between any combination of
 * note, file, skill, agent, or folder objects.
 *
 * Rules:
 * - Both endpoints must exist in the same workspace.
 * - Self-links are rejected (same type AND same id).
 * - Note-to-note links within the same box continue to use note_links for
 *   backward compatibility. This service handles heterogeneous links and
 *   cross-type relationships.
 * - Relationship vocabulary: the same 10-value set as note_links.
 * - Links are replaced (delete + re-create), never mutated in place.
 */

export async function createLink(
  supabase: SupabaseClient,
  workspaceId: string,
  {
    sourceObjectType,
    sourceObjectId,
    targetObjectType,
    targetObjectId,
    relationshipType,
    relationshipNote,
  }: {
    sourceObjectType: ObjectType;
    sourceObjectId: string;
    targetObjectType: ObjectType;
    targetObjectId: string;
    relationshipType: RelationshipType;
    relationshipNote?: string | null;
  }
): Promise<ObjectLink> {
  if (sourceObjectType === targetObjectType && sourceObjectId === targetObjectId) {
    throw new Error("Self-links are not allowed");
  }

  const [source, target] = await Promise.all([
    getWorkspaceObject(supabase, sourceObjectType, sourceObjectId),
    getWorkspaceObject(supabase, targetObjectType, targetObjectId),
  ]);

  if (!source || source.workspace_id !== workspaceId) {
    throw new Error("Source object not found in workspace");
  }
  if (!target || target.workspace_id !== workspaceId) {
    throw new Error("Target object not found in workspace");
  }

  return createObjectLink(supabase, {
    workspace_id: workspaceId,
    source_object_type: sourceObjectType,
    source_object_id: sourceObjectId,
    target_object_type: targetObjectType,
    target_object_id: targetObjectId,
    relationship_type: relationshipType,
    relationship_note: relationshipNote ?? null,
  });
}

export async function removeLink(
  supabase: SupabaseClient,
  _workspaceId: string,
  linkId: string
): Promise<void> {
  await deleteObjectLink(supabase, linkId);
}

export async function getLinksForObject(
  supabase: SupabaseClient,
  workspaceId: string,
  objectType: ObjectType,
  objectId: string
): Promise<{ outgoing: ObjectLink[]; incoming: ObjectLink[] }> {
  const [outgoing, incoming] = await Promise.all([
    getObjectLinksForSource(supabase, workspaceId, objectType, objectId),
    getObjectLinksForTarget(supabase, workspaceId, objectType, objectId),
  ]);
  return { outgoing, incoming };
}
