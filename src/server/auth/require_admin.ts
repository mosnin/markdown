import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { type User } from "@supabase/supabase-js";

/**
 * Guards a server render by requiring the current user to be an admin.
 *
 * "Admin" is defined as having an email address listed in the ADMIN_EMAILS
 * environment variable (comma-separated, whitespace-trimmed). The check uses
 * the Supabase server client so the session is verified against Supabase's
 * servers — safe to trust for authorization decisions.
 *
 * Behavior when access is denied:
 *   - Not authenticated → redirects to /sign_in
 *   - Authenticated but not admin → redirects to /app (404-like, reveals nothing)
 *
 * Use at the top of every admin layout and page:
 *
 * @example
 * ```ts
 * const user = await requireAdmin();
 * // user.email is guaranteed to be in ADMIN_EMAILS
 * ```
 */
export async function requireAdmin(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign_in");
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const userEmail = (user.email ?? "").toLowerCase();

  if (!userEmail || !adminEmails.includes(userEmail)) {
    // Redirect non-admins to /app — gives nothing away about /admin existence
    redirect("/app");
  }

  return user;
}
