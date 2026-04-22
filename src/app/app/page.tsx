import { after } from "next/server";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listOperatorRuns } from "@/server/services/workspace_operator_runs_service";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { ConversationHomeClient } from "@/components/product/conversation_home_client";
import { ensureDailyNoteAction } from "@/app/app/daily_note/actions";
import { isWorkspaceOperatorEnabled } from "@/lib/env";

export default async function ConversationHomePage() {
  const ctx = await requireAuthenticatedUser();

  after(async () => {
    try {
      await ensureDailyNoteAction();
    } catch {
      // non-critical; never block the page
    }
  });
  const supabase = await createClient();

  // Fetch the most recent N runs for this workspace, oldest first so the
  // transcript reads top-to-bottom like a chat. The history table elsewhere
  // shows a paginated view; here we only show recent context.
  const RECENT_RUNS_LIMIT = 30;
  const runsResult = await listOperatorRuns(supabase, {
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    limit: RECENT_RUNS_LIMIT,
  });
  // listOperatorRuns returns { rows, nextCursor } sorted DESC by created_at.
  // Reverse for chronological display.
  const initialRuns = runsResult.rows.slice().reverse();

  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);
  const defaultBoxId = boxes[0]?.id ?? null;
  const userDisplayName = ctx.user?.email ?? null;
  const nowIso = new Date().toISOString();
  const operatorEnabled = isWorkspaceOperatorEnabled();

  return (
    <ConversationHomeClient
      workspaceId={ctx.workspace.id}
      initialRuns={initialRuns}
      defaultBoxId={defaultBoxId}
      hasNoBoxes={boxes.length === 0}
      nowIso={nowIso}
      userDisplayName={userDisplayName}
      workspaceName={ctx.workspace.name}
      operatorEnabled={operatorEnabled}
    />
  );
}
