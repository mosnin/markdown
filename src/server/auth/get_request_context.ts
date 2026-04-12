import { cookies } from "next/headers";
import { type User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { type WorkspaceContext } from "@/server/domain/types/workspace";
import { getOrCreateDefaultWorkspace } from "@/server/services/workspace_bootstrap/get_or_create_default_workspace";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The canonical request context for Context Store.
 *
 * This is the single place all server-side code touches to access the
 * current user and any derived context. Extend this interface as new
 * context layers are added — do not create parallel auth-fetching patterns.
 *
 * Planned extensions (not yet implemented):
 *   permissions: PermissionContext | null  — resolved RBAC grants
 */
export interface RequestContext {
  /** Supabase User object, or null if unauthenticated. */
  user: User | null;
  /** Convenience flag. Equivalent to `user !== null`. */
  isAuthenticated: boolean;
  /**
   * The user's active workspace. Populated for authenticated requests.
   * Null only when the user is not authenticated.
   * A default workspace is bootstrapped on first access if none exists.
   * When the user owns multiple workspaces, the active one is selected
   * via the `active_workspace_id` cookie, set by
   * `setActiveWorkspaceAction`.
   */
  workspace: WorkspaceContext | null;
  // Future: permissions: PermissionContext | null;
}

/** Cookie key used to persist the user's active workspace across requests. */
export const ACTIVE_WORKSPACE_COOKIE = "active_workspace_id";

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Resolves the request context for the current server render.
 *
 * Use this in Server Components, Server Actions, and Route Handlers.
 * It calls `supabase.auth.getUser()` which verifies the JWT with the
 * Supabase server — safe to trust for authorization decisions.
 *
 * For authenticated users, the workspace is loaded (or bootstrapped on
 * first access). Multi-workspace users have their active workspace
 * selection honored via the `active_workspace_id` cookie.
 *
 * @example
 * ```ts
 * const ctx = await getRequestContext();
 * if (!ctx.isAuthenticated) redirect('/sign_in');
 * const { workspace } = ctx; // WorkspaceContext, non-null here
 * ```
 */
export async function getRequestContext(): Promise<RequestContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, isAuthenticated: false, workspace: null };
  }

  // Read the preferred workspace from the cookie, if any. If the cookie
  // points at a workspace the user no longer owns, the bootstrap
  // function silently falls back to the first owned workspace.
  let preferredWorkspaceId: string | null = null;
  try {
    const cookieStore = await cookies();
    preferredWorkspaceId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null;
  } catch {
    // cookies() throws in a handful of non-request contexts; fall back
    // to default workspace selection silently.
    preferredWorkspaceId = null;
  }

  const workspace = await getOrCreateDefaultWorkspace(
    supabase,
    user.id,
    preferredWorkspaceId,
  );

  const workspaceContext: WorkspaceContext = {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    owner_id: workspace.owner_id,
  };

  return {
    user,
    isAuthenticated: true,
    workspace: workspaceContext,
  };
}
