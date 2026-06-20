import { after } from "next/server";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { ConversationHomeClient } from "@/components/product/conversation_home_client";
import { BoxesBento } from "@/components/product/boxes_bento";
import { ensureDailyNoteAction } from "@/app/app/daily_note/actions";
import { STARTER_BOX_SLUG } from "@/server/services/workspace_bootstrap/seed_starter_box";

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
  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);

  // First-run signal: a workspace with no real context yet. The seeded
  // "Getting started" box counts as empty for activation purposes, so a
  // user whose only box is the starter still sees the connect-an-agent
  // guidance until they add their own context or wire up an agent.
  const hasOwnContext = boxes.some((box) => box.slug !== STARTER_BOX_SLUG);
  const isFirstRun = !hasOwnContext;

  // Established workspace: render the bento grid of the user's boxes. We pass
  // only the already-fetched `boxes` (no per-box queries — the old dashboard's
  // per-box note-count loop was a known perf problem) and the workspace name.
  if (!isFirstRun) {
    return <BoxesBento boxes={boxes} workspaceName={ctx.workspace.name} />;
  }

  // ── First run: keep the existing guided onboarding / conversation home. ──
  const defaultBoxId = boxes[0]?.id ?? null;

  // For brand-new workspaces, surface the guided activation checklist with real
  // progress (connected an agent? reviewed an edit?). Cheap count queries, run
  // only on first run so the home stays fast for established users.
  const adminClient = createAdminClient();
  const [agentRes, reviewedRes, pendingRes] = await Promise.all([
    adminClient
      .from("connections")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspace.id)
      .neq("status", "revoked"),
    adminClient
      .from("write_proposals")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspace.id)
      .neq("status", "pending"),
    adminClient
      .from("write_proposals")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "pending"),
  ]);
  const onboarding: { agent: boolean; edit: boolean; pendingCount: number } = {
    agent: (agentRes.count ?? 0) > 0,
    edit: (reviewedRes.count ?? 0) > 0,
    pendingCount: pendingRes.count ?? 0,
  };

  return (
    <ConversationHomeClient
      defaultBoxId={defaultBoxId}
      isFirstRun={isFirstRun}
      onboarding={onboarding}
    />
  );
}
