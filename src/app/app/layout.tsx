import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { AppShell } from "@/components/product/app_shell";

/**
 * Authenticated app layout.
 *
 * Primary auth gate for the /app route tree. Verifies the session
 * server-side and bootstraps the workspace on first access. Loads
 * the box list for the sidebar so every route in /app has real navigation.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);

  return (
    <AppShell
      userEmail={ctx.user?.email ?? ""}
      workspaceName={ctx.workspace.name}
      boxes={boxes}
    >
      {children}
    </AppShell>
  );
}
