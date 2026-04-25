import { notFound, redirect } from "next/navigation";

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getOperatorRun } from "@/server/services/workspace_operator_runs_service";
import { getRunPlan } from "@/server/services/run_plans_service";
import { OperatorLiveView } from "@/components/product/operator/operator_live_view";

/**
 * Live Workspace Operator view — a full-page, Claude Code-style three-column
 * workspace for an active Operator run.
 *
 * Ownership is enforced at the page boundary (notFound on mismatch) and
 * terminal runs are redirected to the read-only historical view so users
 * don't land on a "live" screen with no activity.
 */

interface PageProps {
  params: Promise<{ runId: string }>;
}

export default async function OperatorLiveRunPage({ params }: PageProps) {
  const { runId } = await params;
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const run = await getOperatorRun(supabase, runId);
  if (!run) notFound();
  if (run.user_id !== ctx.user.id) notFound();
  if (run.workspace_id !== ctx.workspace.id) notFound();

  // Terminal runs have nothing live to show — bounce to the read-only
  // detail view so users see the final plan / artifacts / diff.
  if (
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "cancelled"
  ) {
    redirect(`/app/workspace_operator/${runId}`);
  }

  const plan = await getRunPlan(supabase, runId);

  return (
    <OperatorLiveView
      runId={runId}
      workspaceId={ctx.workspace.id}
      initialRun={run}
      initialPlan={plan}
    />
  );
}
