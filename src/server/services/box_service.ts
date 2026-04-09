import { type SupabaseClient } from "@supabase/supabase-js";
import { type Box } from "@/server/domain/types/box";
import {
  getBoxById,
  getBoxBySlug,
  listBoxesByWorkspace,
  createBox as repoCreate,
  updateBox as repoUpdate,
} from "@/server/repositories/box_repository";
import { slugify } from "@/lib/slugify";
import {
  auditBoxCreated,
  auditBoxUpdated,
} from "@/server/services/audit_service";

/**
 * Box service.
 *
 * Orchestrates box repositories, slug generation, and audit events.
 * All callers are responsible for supplying a verified userId and workspaceId
 * from getRequestContext().
 */

export async function listBoxes(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Box[]> {
  return listBoxesByWorkspace(supabase, workspaceId);
}

/**
 * Fetch a box by id, verifying it belongs to the given workspace.
 * Returns null if the box does not exist or belongs to a different workspace.
 */
export async function getBoxForWorkspace(
  supabase: SupabaseClient,
  boxId: string,
  workspaceId: string
): Promise<Box | null> {
  const box = await getBoxById(supabase, boxId);
  if (!box || box.workspace_id !== workspaceId) return null;
  return box;
}

export async function createBox(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  { name, description }: { name: string; description?: string | null }
): Promise<Box> {
  // Generate a slug unique within this workspace
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  while ((await getBoxBySlug(supabase, workspaceId, slug)) !== null) {
    slug = `${base}-${suffix++}`;
  }

  const box = await repoCreate(supabase, {
    workspace_id: workspaceId,
    name,
    slug,
    description: description ?? null,
  });

  await auditBoxCreated(supabase, workspaceId, userId, box.id, box.name);
  return box;
}

export async function updateBox(
  supabase: SupabaseClient,
  userId: string,
  boxId: string,
  workspaceId: string,
  changes: { name?: string; description?: string | null }
): Promise<Box | null> {
  const box = await repoUpdate(supabase, boxId, changes);
  if (!box) return null;

  await auditBoxUpdated(supabase, workspaceId, userId, boxId, changes);
  return box;
}
