import Link from "next/link";
import { Bot, GitBranch } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/product/page_header";
import { EmptyState } from "@/components/product/empty_state";
import {
  listOperatorRuns,
  type OperatorRunStatus,
  type WorkspaceOperatorRunRow,
} from "@/server/services/workspace_operator_runs_service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<
  OperatorRunStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  queued: "secondary",
  planning: "secondary",
  awaiting_approval: "outline",
  executing: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function truncate(text: string, max = 140): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function RunRow({ run }: { run: WorkspaceOperatorRunRow }) {
  return (
    <li className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {truncate(run.prompt)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{relativeTime(run.created_at)}</span>
            <span>·</span>
            <span>mode: {run.mode}</span>
            <span>·</span>
            <span>{run.notes_created.length} note{run.notes_created.length === 1 ? "" : "s"}</span>
            {run.tool_calls > 0 && (
              <>
                <span>·</span>
                <span>{run.tool_calls} tool calls</span>
              </>
            )}
            {run.branch_id && (
              <>
                <span>·</span>
                <Link
                  href={`/app/branches/${run.branch_id}`}
                  className="inline-flex items-center gap-1 text-foreground hover:underline"
                >
                  <GitBranch className="h-3 w-3" aria-hidden="true" />
                  branch
                </Link>
              </>
            )}
          </div>
          {run.error && (
            <p className="mt-1 text-xs text-destructive">{truncate(run.error, 200)}</p>
          )}
        </div>
        <Badge variant={STATUS_VARIANT[run.status]} className="shrink-0">
          {run.status.replace(/_/g, " ")}
        </Badge>
      </div>
    </li>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function OperatorRunsPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const { rows } = await listOperatorRuns(supabase, {
    userId: ctx.user.id,
    limit: 50,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Operator runs"
        description="Recent Workspace Operator invocations across all your workspaces."
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-4xl px-6 py-6">
          {rows.length === 0 ? (
            <EmptyState
              icon={<Bot />}
              title="No operator runs yet"
              description="When you kick off a Workspace Operator run, it will appear here with its status, notes drafted, and a link to the resulting branch."
            />
          ) : (
            <ul className="flex flex-col gap-3 list-none p-0">
              {rows.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
