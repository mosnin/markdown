import { type User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The canonical request context for Context Store.
 *
 * This is the single place later prompts touch to access the current
 * user and any derived context. Extend this interface as new context
 * layers are added — do not create parallel auth-fetching patterns.
 *
 * Planned extensions (not yet implemented):
 *   workspace: WorkspaceContext | null  — active workspace identity
 *   permissions: PermissionContext | null  — resolved RBAC grants
 */
export interface RequestContext {
  /** Supabase User object, or null if unauthenticated. */
  user: User | null;
  /** Convenience flag. Equivalent to `user !== null`. */
  isAuthenticated: boolean;
  // Future: workspace: WorkspaceContext | null;
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
 * @example
 * ```ts
 * const ctx = await getRequestContext();
 * if (!ctx.isAuthenticated) redirect('/sign_in');
 * ```
 */
export async function getRequestContext(): Promise<RequestContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    user,
    isAuthenticated: user !== null,
  };
}
