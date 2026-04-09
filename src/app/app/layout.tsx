import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { AppShell } from "@/components/product/app_shell";

/**
 * Authenticated app layout.
 *
 * This is the primary auth gate for the /app route tree. `requireAuthenticatedUser`
 * verifies the session server-side and redirects to /sign_in if the user
 * is not authenticated. No client-side check is needed or trusted.
 *
 * The resolved user email is threaded into the shell so the sidebar can
 * show user identity and the sign-out affordance without re-fetching.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuthenticatedUser();

  return (
    <AppShell userEmail={user.email ?? ""}>
      {children}
    </AppShell>
  );
}
