import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listChangeSetsForWorkspace } from "@/server/services/change_set_service";
import { PageHeader } from "@/components/product/page_header";
import { HistoryClient } from "./history_client";

/**
 * Workspace history (change set activity).
 *
 * Lists every committed change set for the active workspace in reverse
 * chronological order with an "Undo" button per row. Clicking a row
 * opens a detail panel with the items / structural events so the user
 * can see exactly what will be reverted before confirming.
 *
 * Access: any workspace member can see history. Restore is a write
 * operation gated server-side by `requireWriteRoleResult` — viewers
 * will see the Undo button hidden, but even if they could render it,
 * the server action returns an actionable error.
 */
export default async function HistoryPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const initialRows = await listChangeSetsForWorkspace(
    supabase,
    ctx.workspace.id,
    { limit: 100 }
  );

  const canRestore = ctx.workspace.role !== "viewer";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="History"
        description="Every grouped change to this workspace. Open any entry to see what changed, or undo the whole group at once."
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-4 py-6 md:px-6">
          <HistoryClient initialRows={initialRows} canRestore={canRestore} />
        </div>
      </div>
    </div>
  );
}
