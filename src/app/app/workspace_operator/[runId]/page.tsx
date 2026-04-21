import { notFound } from "next/navigation";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getOperatorRun } from "@/server/services/workspace_operator_runs_service";
import { listRunArtifacts } from "@/server/services/operator_artifacts_service";
import { OperatorRunDetail } from "@/components/product/operator_run_detail";
import { OperatorRunDiff } from "@/components/product/operator_run_diff";

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
      <div className="bg-background">
        <div className="px-6 pt-6 pb-4">
          <Link
            href="/app/workspace_operator"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Back to history
          </Link>
          <Link
            href={`/app/workspace_operator/${runId}/replay`}
            className="ml-3 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Open replay →
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            Operator run
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only view of a single Operator invocation.
          </p>
        </div>
        <Separator />
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-6">
          <OperatorRunDetail
            run={run}
            hasLiveArtifacts={hasLiveArtifacts}
          />
          <OperatorRunDiff artifacts={artifacts} />
        </div>
      </div>
    </div>
  );
}
