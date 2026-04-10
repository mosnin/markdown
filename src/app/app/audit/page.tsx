import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listWorkspaceAuditEvents } from "@/server/services/audit_view_service";
import { AuditPanel } from "@/components/product/audit_panel";
import { Separator } from "@/components/ui/separator";

/**
 * Workspace audit log browser.
 *
 * Displays an append-only record of all workspace events — note lifecycle
 * changes, write proposals, AI agent actions, and more. Read-only view;
 * no mutations are possible from this page.
 */
export default async function AuditPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const result = await listWorkspaceAuditEvents(supabase, ctx.workspace.id, {
    limit: 50,
    page: 1,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page header */}
      <div className="bg-background">
        <div className="px-6 pt-6 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Audit Log
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All changes and actions in your workspace
          </p>
        </div>
        <Separator />
      </div>

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
