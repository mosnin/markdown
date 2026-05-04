// Soft-archived behind the `advanced_surfaces` feature flag (Move 4):
// default-tier users are redirected to /app; enterprise admins keep access.
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { requireAdvancedSurfaces } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import { listWorkspaceAuditEvents } from "@/server/services/audit_view_service";
import { AuditPanel } from "@/components/product/audit_panel";
import { PageHeader } from "@/components/product/page_header";

/**
 * Workspace audit log browser.
 *
 * Displays an append-only record of all workspace events — note lifecycle
 * changes, write proposals, AI agent actions, and more. Read-only view;
 * no mutations are possible from this page.
 */
export default async function AuditPage() {
  const ctx = await requireAuthenticatedUser();
  await requireAdvancedSurfaces(ctx);
  const supabase = await createClient();

  const result = await listWorkspaceAuditEvents(supabase, ctx.workspace.id, {
    limit: 50,
    page: 1,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Audit log"
        description="An append-only record of every change and action in your workspace."
      />

      {/* Panel */}
      <div className="flex-1 overflow-hidden">
        <AuditPanel
          initialEvents={result.events}
          workspaceId={ctx.workspace.id}
        />
      </div>
    </div>
  );
}
