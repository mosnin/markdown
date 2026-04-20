import { Separator } from "@/components/ui/separator";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listOperatorRuns } from "@/server/services/workspace_operator_runs_service";
import { OperatorHistoryTable } from "@/components/product/operator_history_table";
import Link from "next/link";

/**
 * Default landing for /app/workspace_operator — the current user's run
 * history for the active workspace, newest first. The actual table is a
 * client component so it can paginate via the cursor without a full
 * page reload.
 */
export default async function WorkspaceOperatorHistoryPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const initial = await listOperatorRuns(supabase, {
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    limit: 25,
  });

  // Server captures `now` once and passes it to the client; the
  // formatRelativeDate helper requires an explicit `now` so the server
  // and client renders agree during hydration.
  const nowIso = new Date().toISOString();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="bg-background">
        <div className="flex items-start justify-between gap-2 px-6 pt-6 pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Workspace Operator
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              History of your Operator runs in this workspace.
            </p>
          </div>
          <Link
            href="/app/workspace_operator/prompts"
            className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground hover:bg-muted"
          >
            Saved prompts
          </Link>
        </div>
        <Separator />
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <OperatorHistoryTable
            initialRows={initial.rows}
            initialCursor={initial.nextCursor}
            nowIso={nowIso}
          />
        </div>
      </div>
    </div>
  );
}
