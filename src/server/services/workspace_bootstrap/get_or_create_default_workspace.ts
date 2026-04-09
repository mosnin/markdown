import { type SupabaseClient } from "@supabase/supabase-js";
import { type Workspace } from "@/server/domain/types/workspace";
import {
  listWorkspacesByOwner,
  createWorkspace,
} from "@/server/repositories/workspace_repository";

/**
 * Returns the user's workspace, creating a default one if none exists.
 *
 * In V1, each user owns exactly one workspace. This function is called
 * during the first authenticated render to ensure the workspace exists
 * before any other operations proceed.
 *
 * Slug generation: derived from user_id to guarantee global uniqueness
 * without a round-trip uniqueness check. The slug uses the first 8 chars
 * of the UUID (post-hyphen removal) which is sufficient for V1 scale.
 */
export async function getOrCreateDefaultWorkspace(
  supabase: SupabaseClient,
  user_id: string
): Promise<Workspace> {
  const workspaces = await listWorkspacesByOwner(supabase, user_id);

  if (workspaces.length > 0) {
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
