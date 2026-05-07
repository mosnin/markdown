import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getOperatorRun } from "@/server/services/workspace_operator_runs_service";
import { listRunArtifacts } from "@/server/services/operator_artifacts_service";
import { OperatorRunDetail } from "@/components/product/operator/operator_run_detail";
import { OperatorRunDiff } from "@/components/product/operator/operator_run_diff";
import { OperatorPlanSheet } from "@/components/product/operator/operator_plan_sheet";
import { OperatorSessionsDrawer } from "@/components/product/operator/operator_sessions_drawer";
import { PageHeader } from "@/components/product/page_header";

/**
 * Run detail view: header, plan, result, artifact diff, actions.
 *
 * Ownership is enforced at the page boundary — if the run isn't owned
 * by the current user OR isn't scoped to the active workspace, render
 * notFound() rather than leaking the existence of another user's run.
 */

interface PageProps {
  params: Promise<{ runId: string }>;
}

export default async function OperatorRunDetailPage({ params }: PageProps) {
  const { runId } = await params;
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const run = await getOperatorRun(supabase, runId);
  if (!run) notFound();
  if (run.user_id !== ctx.user.id) notFound();
  if (run.workspace_id !== ctx.workspace.id) notFound();

  const artifacts = await listRunArtifacts(supabase, runId);
  const hasLiveArtifacts = artifacts.some((a) => !a.deleted);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Operator run"
        description="Read-only view of a single Operator invocation."
        actions={
          <>
            <Link
              href="/app/workspace_operator"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              History
            </Link>
            <OperatorSessionsDrawer activeSessionId={run.session_id ?? null} />
            <Link
              href={`/app/workspace_operator/${runId}/replay`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Open replay
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-6">
          <OperatorRunDetail
            run={run}
            hasLiveArtifacts={hasLiveArtifacts}
          />
          <OperatorRunDiff artifacts={artifacts} />
        </div>
      </div>

      {/* Mobile-only bottom-sheet plan/diff. Hidden on `lg:` where the
          plan/diff continues to live as a desktop right-rail; the sheet
          self-hides when the run reaches a terminal state. */}
      <OperatorPlanSheet run={{ id: run.id, status: run.status }} />
    </div>
  );
}
