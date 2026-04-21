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
    branchId = null,
  }: {
    sourceObjectType: ObjectType;
    sourceObjectId: string;
    targetObjectType: ObjectType;
    targetObjectId: string;
    relationshipType: RelationshipType;
    relationshipNote?: string | null;
    /**
     * Optional branch ownership. When set, the link row is stamped
     * with `branch_id` on insert so main readers never see it until
     * promote. Detach on a branch-local row is a hard-delete; detach
     * on a main row routes through `branch_pending_ops` at the
     * action layer.
     */
    branchId?: string | null;
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
    branch_id: branchId ?? null,
  });
}

export async function removeLink(
  supabase: SupabaseClient,
  workspaceId: string,
  linkId: string
): Promise<void> {
  const { data: link } = await supabase
    .from("object_links")
    .select("id, workspace_id")
    .eq("id", linkId)
    .maybeSingle();
  if (!link || link.workspace_id !== workspaceId) {
    throw new Error("Link not found");
  }
  await deleteObjectLink(supabase, linkId, workspaceId);
}

export async function getLinksForObject(
  supabase: SupabaseClient,
  workspaceId: string,
  objectType: ObjectType,
  objectId: string,
  opts: { branchId?: string | null } = {}
): Promise<{ outgoing: ObjectLink[]; incoming: ObjectLink[] }> {
  const [outgoing, incoming] = await Promise.all([
    getObjectLinksForSource(supabase, workspaceId, objectType, objectId),
    getObjectLinksForTarget(supabase, workspaceId, objectType, objectId),
  ]);
  // Branch filter. object_links.branch_id is NULL for main links.
  // Main-only readers (no active branch) drop any row with a
  // non-null branch_id. Branch readers keep main + rows scoped to
  // that branch.
  const filter = (l: ObjectLink): boolean => {
    const bid = (l as ObjectLink & { branch_id?: string | null }).branch_id ?? null;
    if (!opts.branchId) return bid === null;
    return bid === null || bid === opts.branchId;
  };
  return {
    outgoing: outgoing.filter(filter),
    incoming: incoming.filter(filter),
  };
}
