// Soft-archived behind the `advanced_surfaces` feature flag (Move 4):
// default-tier users are redirected to /app; enterprise admins keep access.
import Link from "next/link";
import { GitFork, LayoutTemplate } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { requireAdvancedSurfaces } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import { listWorkflowsByWorkspace } from "@/server/repositories/workflow_repository";
import { PageHeader } from "@/components/product/page_header";
import { WorkflowRow } from "@/components/product/workflows/workflow_row";
import { CreateWorkflowButton } from "@/components/product/create/create_workflow_button";

export default async function WorkflowsPage() {
  const ctx = await requireAuthenticatedUser();
  await requireAdvancedSurfaces(ctx);
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
      <PageHeader
        title="Workflows"
        description="Visual builder for multi-step agent flows. Chain sub-agents, web tools, and transformations into reusable pipelines."
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-6">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
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
            <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center">
              <GitFork
                className="mx-auto mb-3 h-6 w-6 text-muted-foreground/40"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-foreground">
                No workflows yet
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                Workflows let you design multi-step agent flows visually. Create
                your first workflow to chain sub-agents, web tools, and
                transformations.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2 list-none">
              {workflows.map((w) => {
                const latest = latestRuns.get(w.id);
                return (
                  <li key={w.id}>
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
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
