import Link from "next/link";
import { GitFork, LayoutTemplate } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listWorkflowsByWorkspace } from "@/server/repositories/workflow_repository";
import { WorkflowRow } from "@/components/product/workflows/workflow_row";
import { CreateWorkflowButton } from "@/components/product/create/create_workflow_button";
import { WorkflowsPageHeader } from "@/components/product/workflows/workflows_page_header";
import { PageStagger, StaggerItem } from "@/components/product/page_transition";
import { buttonVariants } from "@/components/ui/button";

export default async function WorkflowsPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const workflows = await listWorkflowsByWorkspace(supabase, ctx.workspace.id, {
    limit: 50,
  });

  // Hydrate latest run status per workflow in one query.
  const workflowIds = workflows.map((w) => w.id);
  const latestRuns = new Map<
    string,
    { status: string; started_at: string }
  >();
  if (workflowIds.length > 0) {
    const { data: runs } = await supabase
      .from("workflow_runs")
      .select("workflow_id, status, started_at")
      .in("workflow_id", workflowIds)
      .order("started_at", { ascending: false });
    if (runs) {
      for (const r of runs as Array<{
        workflow_id: string;
        status: string;
        started_at: string;
      }>) {
        if (!latestRuns.has(r.workflow_id)) {
          latestRuns.set(r.workflow_id, {
            status: r.status,
            started_at: r.started_at,
          });
        }
      }
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <WorkflowsPageHeader />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-6">
          <div className="flex items-center justify-between">
            <p className="text-overline text-muted-foreground">
              {workflows.length}{" "}
              {workflows.length === 1 ? "workflow" : "workflows"}
            </p>
            <div className="flex items-center gap-2">
              <Link
                href="/app/workflows/templates"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                <LayoutTemplate className="h-3.5 w-3.5" aria-hidden="true" />
                Browse templates
              </Link>
              <CreateWorkflowButton />
            </div>
          </div>

          {workflows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
              <div className="rounded-lg border border-border p-3">
                <GitFork className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-medium">No workflows yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Design multi-step agent flows visually. Chain sub-agents, web tools,
                  and transformations.
                </p>
              </div>
              <Link
                href="/app/workflows/templates"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                Browse templates
              </Link>
            </div>
          ) : (
            <PageStagger className="flex flex-col gap-2">
              {workflows.map((w) => {
                const latest = latestRuns.get(w.id);
                return (
                  <StaggerItem key={w.id}>
                    <WorkflowRow
                      workflow={w}
                      latestRunStatus={
                        latest?.status as
                          | "queued"
                          | "running"
                          | "completed"
                          | "failed"
                          | "cancelled"
                          | undefined
                      }
                      latestRunAt={latest?.started_at ?? null}
                    />
                  </StaggerItem>
                );
              })}
            </PageStagger>
          )}
        </div>
      </div>
    </div>
  );
}
