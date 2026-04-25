import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GitFork } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getWorkflowById } from "@/server/repositories/workflow_repository";
import { listWorkflowRunsForWorkflow } from "@/server/repositories/workflow_run_repository";
import { PageHeader } from "@/components/product/page_header";
import { WorkflowRunRow } from "@/components/product/workflows/workflow_run_row";

interface RunsPageProps {
  params: Promise<{ workflow_id: string }>;
}

export default async function WorkflowRunsPage({ params }: RunsPageProps) {
  const { workflow_id } = await params;
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const workflow = await getWorkflowById(supabase, workflow_id);
  if (!workflow || workflow.workspace_id !== ctx.workspace.id) notFound();

  const runs = await listWorkflowRunsForWorkflow(supabase, workflow_id, {
    limit: 50,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={`Runs · ${workflow.name}`}
        description={`Execution history for this workflow · ${runs.length} ${runs.length === 1 ? "run" : "runs"}`}
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-6">
          <div className="flex items-center justify-between">
            <Link
              href="/app/workflows"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              All workflows
            </Link>
            <Link
              href={`/app/workflows/${workflow_id}/edit`}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent"
            >
              Edit workflow
            </Link>
          </div>

          {runs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center">
              <GitFork
                className="mx-auto mb-3 h-6 w-6 text-muted-foreground/40"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-foreground">
                No runs yet
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                Open the workflow editor and click Run to execute it.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2 list-none">
              {runs.map((r) => (
                <li key={r.id}>
                  <WorkflowRunRow run={r} workflowId={workflow_id} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
