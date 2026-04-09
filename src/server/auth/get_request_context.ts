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
   * The user's workspace. Populated for authenticated requests.
   * Null only when the user is not authenticated.
   * In V1, a workspace is bootstrapped on first access if none exists.
   */
  workspace: WorkspaceContext | null;
  // Future: permissions: PermissionContext | null;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Resolves the request context for the current server render.
 *
 * Use this in Server Components, Server Actions, and Route Handlers.
 * It calls `supabase.auth.getUser()` which verifies the JWT with the
 * Supabase server — safe to trust for authorization decisions.
 *
 * For authenticated users, the workspace is loaded (or bootstrapped on
 * first access). This ensures all downstream code can safely assume
 * `ctx.workspace` is non-null whenever `ctx.isAuthenticated` is true.
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

  const workspace = await getOrCreateDefaultWorkspace(supabase, user.id);

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
