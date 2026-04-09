import { redirect } from "next/navigation";
import { type User } from "@supabase/supabase-js";
import { getRequestContext } from "./get_request_context";

/**
 * Guards a server render by requiring an authenticated user.
 *
 * If no session is found, redirects to /sign_in. Otherwise returns
 * the verified User object so the caller can use it directly.
 *
 * Use this at the top of protected layouts and pages:
 *
 * @example
 * ```ts
 * // app/app/layout.tsx
 * const user = await requireAuthenticatedUser();
 * ```
 *
 * Do NOT rely on client-side checks for route protection. This server
 * call is the authoritative guard.
 */
export async function requireAuthenticatedUser(): Promise<User> {
  const ctx = await getRequestContext();

  if (!ctx.isAuthenticated || !ctx.user) {
    redirect("/sign_in");
  }

  return ctx.user;
}
