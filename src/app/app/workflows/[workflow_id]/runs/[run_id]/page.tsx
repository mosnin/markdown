import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
  Ban,
} from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getWorkflowById } from "@/server/repositories/workflow_repository";
import {
  getWorkflowRunById,
  listNodeRunsByRun,
} from "@/server/repositories/workflow_run_repository";
import { PageHeader } from "@/components/product/page_header";
import { cn } from "@/lib/utils";
import type {
  WorkflowNodeType,
  WorkflowNodeRunStatus,
  WorkflowRunStatus,
  WorkflowNode,
  WorkflowNodeRun,
} from "@/server/domain/types/workflow";

interface RunDetailPageProps {
  params: Promise<{ workflow_id: string; run_id: string }>;
}

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function nodeTypeIcon(type: WorkflowNodeType): string {
  switch (type) {
    case "start":
      return "▶";
    case "subagent":
      return "🤖";
    case "web_search":
      return "🔍";
    case "web_fetch":
      return "🌐";
    case "transform":
      return "⚡";
    case "condition":
      return "◇";
    case "merge":
      return "⬡";
    case "end":
      return "⏹";
  }
}

function runStatusBadgeClass(status: WorkflowRunStatus): string {
  switch (status) {
    case "queued":
      return "bg-muted text-muted-foreground";
    case "running":
      return "bg-blue-500/10 text-blue-600";
    case "completed":
      return "bg-emerald-500/10 text-emerald-600";
    case "failed":
      return "bg-rose-500/10 text-rose-600";
    case "cancelled":
      return "bg-muted text-muted-foreground";
  }
}

function nodeStatusBadgeClass(status: WorkflowNodeRunStatus): string {
  switch (status) {
    case "pending":
      return "bg-muted text-muted-foreground";
    case "running":
      return "bg-blue-500/10 text-blue-600";
    case "completed":
      return "bg-emerald-500/10 text-emerald-600";
    case "failed":
      return "bg-rose-500/10 text-rose-600";
    case "skipped":
      return "bg-muted text-muted-foreground";
  }
}

function RunStatusIcon({ status }: { status: WorkflowRunStatus }) {
  const base = "h-4 w-4 shrink-0";
  switch (status) {
    case "queued":
      return <Clock className={cn(base, "text-muted-foreground")} aria-hidden="true" />;
    case "running":
      return <Loader2 className={cn(base, "animate-spin text-blue-500")} aria-hidden="true" />;
    case "completed":
      return <CheckCircle2 className={cn(base, "text-emerald-500")} aria-hidden="true" />;
    case "failed":
      return <XCircle className={cn(base, "text-rose-500")} aria-hidden="true" />;
    case "cancelled":
      return <Ban className={cn(base, "text-rose-500")} aria-hidden="true" />;
  }
}

// ─── Duration helper ──────────────────────────────────────────────────────────

function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

// ─── Node run row ─────────────────────────────────────────────────────────────

function NodeRunRow({
  nodeRun,
  node,
}: {
  nodeRun: WorkflowNodeRun;
  node: WorkflowNode | undefined;
}) {
  const duration = formatDuration(nodeRun.started_at, nodeRun.completed_at);
  const hasInput = nodeRun.input && Object.keys(nodeRun.input).length > 0;
  const hasOutput = nodeRun.output && Object.keys(nodeRun.output).length > 0;

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-start gap-3">
        {/* Node icon + key + type */}
        <span className="mt-0.5 text-base leading-none" aria-hidden="true">
          {node ? nodeTypeIcon(node.node_type) : "•"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-foreground">
              {node?.node_key ?? nodeRun.node_id}
            </span>
            {node && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {node.node_type.replace("_", " ")}
              </span>
            )}
          </div>

          {/* Duration + error */}
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {duration && <span>{duration}</span>}
            {nodeRun.error && (
              <span className="text-rose-500">{nodeRun.error}</span>
            )}
          </div>

          {/* Collapsible input/output */}
          {(hasInput || hasOutput) && (
            <div className="mt-2 space-y-1.5">
              {hasInput && (
                <details className="group">
                  <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground hover:text-foreground select-none">
                    <span className="mr-1 inline-block transition-transform group-open:rotate-90">▶</span>
                    Input
                  </summary>
                  <pre className="mt-1 overflow-auto rounded border border-border bg-muted/40 p-2 text-[11px] text-foreground">
                    {JSON.stringify(nodeRun.input, null, 2)}
                  </pre>
                </details>
              )}
              {hasOutput && (
                <details className="group">
                  <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground hover:text-foreground select-none">
                    <span className="mr-1 inline-block transition-transform group-open:rotate-90">▶</span>
                    Output
                  </summary>
                  <pre className="mt-1 overflow-auto rounded border border-border bg-muted/40 p-2 text-[11px] text-foreground">
                    {JSON.stringify(nodeRun.output, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>

        {/* Status badge */}
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            nodeStatusBadgeClass(nodeRun.status)
          )}
        >
          {nodeRun.status}
        </span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function WorkflowRunDetailPage({
  params,
}: RunDetailPageProps) {
  const { workflow_id, run_id } = await params;
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  // Auth + authorization
  const workflow = await getWorkflowById(supabase, workflow_id);
  if (!workflow || workflow.workspace_id !== ctx.workspace.id) notFound();

  const run = await getWorkflowRunById(supabase, run_id);
  if (!run || run.workflow_id !== workflow_id) notFound();

  const nodeRuns = await listNodeRunsByRun(supabase, run_id);

  // Build a lookup map: node_id → WorkflowNode
  const nodeById = new Map<string, WorkflowNode>(
    workflow.graph.nodes.map((n) => [n.id, n])
  );

  const elapsedLabel = formatDuration(run.started_at, run.completed_at);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={`Run · ${workflow.name}`}
        description={new Date(run.started_at).toLocaleString("en-US")}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-6">
          {/* Back link */}
          <Link
            href={`/app/workflows/${workflow_id}/runs`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            All runs
          </Link>

          {/* Run header card */}
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-start gap-3">
              <RunStatusIcon status={run.status} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">
                  {new Date(run.started_at).toLocaleString("en-US")}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {elapsedLabel && <span>{elapsedLabel}</span>}
                  {run.total_cost_cents > 0 && (
                    <>
                      <span>·</span>
                      <span className="tabular-nums">
                        ${(run.total_cost_cents / 100).toFixed(2)}
                      </span>
                    </>
                  )}
                </p>
                {run.error && (
                  <p className="mt-1 text-[11px] text-rose-500">{run.error}</p>
                )}
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                  runStatusBadgeClass(run.status)
                )}
              >
                {run.status}
              </span>
            </div>
          </div>

          {/* Node runs */}
          {nodeRuns.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No node executions recorded for this run.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Node executions · {nodeRuns.length}
              </p>
              <ul className="flex flex-col gap-2 list-none">
                {nodeRuns.map((nr) => (
                  <li key={nr.id}>
                    <NodeRunRow
                      nodeRun={nr}
                      node={nodeById.get(nr.node_id)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
