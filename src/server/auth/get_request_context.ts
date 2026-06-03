import { cache } from "react";
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
  /**
   * The user's active draft branch, if any. Set via
   * `setActiveBranchAction`; cleared when the user switches back to
   * main. Null means the caller is operating against main. The
   * editor-layer services honour this signal to route writes through
   * `branch_heads` rather than advancing each object's canonical
   * `current_version_id`. Any code path that does NOT want branch
   * semantics (imports, lifecycle, restore engine itself) explicitly
   * ignores this field.
   */
  activeBranchId: string | null;
}

/** Cookie key used to persist the user's active workspace across requests. */
export const ACTIVE_WORKSPACE_COOKIE = "active_workspace_id";

/**
 * Cookie key used to persist the user's active draft branch. Optional —
 * absence means "writing to main". When set, the editor layer routes
 * content writes through branch_heads rather than advancing each
 * object's canonical `current_version_id`. See
 * `docs/branch_aware_writes_v1.md`.
 */
export const ACTIVE_BRANCH_COOKIE = "active_branch_id";

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
 * Wrapped in React `cache()` (see the export below) so it is deduplicated
 * within a single server render. On first login the root layout and the
 * page both resolve the context; without dedup each would independently
 * call `getOrCreateDefaultWorkspace` -> `createWorkspace`, racing on the
 * `UNIQUE(owner_id, slug)` constraint. `cache()` collapses concurrent calls
 * in one render to a single execution. (In server actions / route handlers
 * there is no shared cache scope, so it simply behaves as a normal call.)
 *
 * @example
 * ```ts
 * const ctx = await getRequestContext();
 * if (!ctx.isAuthenticated) redirect('/sign_in');
 * const { workspace } = ctx; // WorkspaceContext, non-null here
 * ```
 */
async function resolveRequestContext(): Promise<RequestContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, isAuthenticated: false, workspace: null, activeBranchId: null };
  }

  // Read the preferred workspace from the cookie, if any. If the cookie
  // points at a workspace the user no longer owns, the bootstrap
  // function silently falls back to the first owned workspace.
  let preferredWorkspaceId: string | null = null;
  let activeBranchId: string | null = null;
  try {
    const cookieStore = await cookies();
    preferredWorkspaceId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null;
    activeBranchId = cookieStore.get(ACTIVE_BRANCH_COOKIE)?.value ?? null;
  } catch {
    // cookies() throws in a handful of non-request contexts; fall back
    // to default workspace selection silently.
    preferredWorkspaceId = null;
    activeBranchId = null;
  }

  const workspace = await getOrCreateDefaultWorkspace(
    supabase,
    user.id,
    preferredWorkspaceId,
  );

  // Validate the branch cookie: it must reference an OPEN draft branch
  // inside the active workspace. A stale cookie (branch deleted /
  // promoted / discarded / in another workspace) is silently cleared.
  let resolvedBranchId: string | null = null;
  if (activeBranchId) {
    const { data: branch } = await supabase
      .from("draft_branches")
      .select("id, workspace_id, status")
      .eq("id", activeBranchId)
      .maybeSingle();
    if (branch && branch.workspace_id === workspace.id && branch.status === "open") {
      resolvedBranchId = activeBranchId;
    }
  }

  const workspaceContext: WorkspaceContext = {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    owner_id: workspace.owner_id,
    role: workspace.role,
  };

  return {
    user,
    isAuthenticated: true,
    workspace: workspaceContext,
    activeBranchId: resolvedBranchId,
  };
}

/**
 * Resolves the request context for the current server render.
 *
 * Deduplicated with React `cache()`: within a single render pass every call
 * (layout, page, nested server components) shares one resolution. This is
 * what prevents the first-login bootstrap race described on
 * `resolveRequestContext` above. Takes no arguments, so the cache key is
 * constant for the render. See `src/server/services/cached_reads.ts` for the
 * same pattern applied to repository reads.
 */
export const getRequestContext = cache(resolveRequestContext);
