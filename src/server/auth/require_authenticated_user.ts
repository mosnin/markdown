import { redirect } from "next/navigation";
import { getRequestContext, type RequestContext } from "./get_request_context";

/**
 * Guards a server render by requiring an authenticated user with a workspace.
 *
 * If no session is found, redirects to /sign_in. Otherwise returns the full
 * RequestContext so callers can access both the User and the WorkspaceContext
 * without a second call to getRequestContext().
 *
 * Use this at the top of protected layouts and pages:
 *
 * @example
 * ```ts
 * const ctx = await requireAuthenticatedUser();
 * // ctx.user — Supabase User
 * // ctx.workspace — WorkspaceContext (non-null, bootstrapped if needed)
 * ```
 */
export async function requireAuthenticatedUser(): Promise<
  RequestContext & {
    user: NonNullable<RequestContext["user"]>;
    workspace: NonNullable<RequestContext["workspace"]>;
  }
> {
  const ctx = await getRequestContext();

  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    redirect("/sign_in");
  }

  return ctx as RequestContext & {
    user: NonNullable<RequestContext["user"]>;
    workspace: NonNullable<RequestContext["workspace"]>;
  };
}
