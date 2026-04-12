import { type SupabaseClient } from "@supabase/supabase-js";
import { type Workspace } from "@/server/domain/types/workspace";
import { createWorkspace } from "@/server/repositories/workspace_repository";
import {
  listAccessibleWorkspaces,
  type WorkspaceRole,
} from "@/server/repositories/workspace_membership_repository";

/**
 * Returns the user's active workspace.
 *
 * Resolution order:
 *   1. If the caller passes a `preferredWorkspaceId` and the user is a
 *      member of that workspace (any role), return it. This is how
 *      multi-workspace selection works.
 *   2. Otherwise return the first accessible workspace (ordered by
 *      creation time). Stable default so every session picks the same
 *      workspace unless the user explicitly switches.
 *   3. If the user has no accessible workspaces, create a default "My
 *      Workspace" owned by them. The membership row is inserted by the
 *      workspace-memberships migration trigger; since we don't rely on a
 *      trigger yet the bootstrap here also writes the admin membership
 *      explicitly so the caller always has the access flag it needs.
 *
 * Slug generation for the default: derived from user_id to guarantee
 * global uniqueness without a round-trip uniqueness check.
 */
export async function getOrCreateDefaultWorkspace(
  supabase: SupabaseClient,
  user_id: string,
  preferredWorkspaceId?: string | null,
): Promise<Workspace & { role: WorkspaceRole }> {
  const workspaces = await listAccessibleWorkspaces(supabase, user_id);

  if (workspaces.length > 0) {
    if (preferredWorkspaceId) {
      const preferred = workspaces.find((w) => w.id === preferredWorkspaceId);
      if (preferred) return preferred;
    }
    return workspaces[0];
  }

  // Derive a slug from the user_id: first 8 chars of uuid without dashes.
  const slugSuffix = user_id.replace(/-/g, "").slice(0, 8);
  const slug = `ws-${slugSuffix}`;

  const ws = await createWorkspace(supabase, {
    owner_id: user_id,
    name: "My Workspace",
    slug,
  });

  // Ensure the owner has a matching admin membership. Under normal
  // operation this is also covered by the backfill migration, but new
  // workspaces created after the migration land here.
  await supabase
    .from("workspace_memberships")
    .insert({
      workspace_id: ws.id,
      user_id,
      role: "admin",
      invited_by: user_id,
      accepted_at: new Date().toISOString(),
    });

  return { ...ws, role: "owner" };
}
