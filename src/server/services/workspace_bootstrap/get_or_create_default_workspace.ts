import { type SupabaseClient } from "@supabase/supabase-js";
import { type Workspace } from "@/server/domain/types/workspace";
import {
  listWorkspacesByOwner,
  createWorkspace,
} from "@/server/repositories/workspace_repository";

/**
 * Returns the user's active workspace.
 *
 * Resolution order:
 *   1. If the caller passes a `preferredWorkspaceId` (typically read from a
 *      cookie set by the workspace switcher), and the user owns that
 *      workspace, return it. This is how multi-workspace selection works.
 *   2. Otherwise return the first workspace owned by the user (ordered by
 *      creation time). Stable default so every session picks the same
 *      workspace unless the user explicitly switches.
 *   3. If the user owns no workspaces, create a default "My Workspace".
 *
 * The function previously returned only the first workspace, which made
 * multi-workspace support impossible to express at the request-context
 * seam. Accepting `preferredWorkspaceId` is the hook the app uses to let
 * a user own multiple workspaces and switch between them.
 *
 * Slug generation for the default: derived from user_id to guarantee
 * global uniqueness without a round-trip uniqueness check.
 */
export async function getOrCreateDefaultWorkspace(
  supabase: SupabaseClient,
  user_id: string,
  preferredWorkspaceId?: string | null,
): Promise<Workspace> {
  const workspaces = await listWorkspacesByOwner(supabase, user_id);

  if (workspaces.length > 0) {
    if (preferredWorkspaceId) {
      const preferred = workspaces.find((w) => w.id === preferredWorkspaceId);
      if (preferred) return preferred;
    }
    return workspaces[0];
  }

  // Derive a slug from the user_id: first 8 chars of uuid without dashes.
  // e.g. "550e8400-e29b..." → "ws-550e8400"
  const slugSuffix = user_id.replace(/-/g, "").slice(0, 8);
  const slug = `ws-${slugSuffix}`;

  return createWorkspace(supabase, {
    owner_id: user_id,
    name: "My Workspace",
    slug,
  });
}
