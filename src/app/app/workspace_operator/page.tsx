import { Separator } from "@/components/ui/separator";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listOperatorRuns } from "@/server/services/workspace_operator_runs_service";
import { OperatorHistoryTable } from "@/components/product/operator/operator_history_table";
import { OperatorNewRunButton } from "@/components/product/operator/operator_new_run_button";
import { PogAgentIntro } from "@/components/product/pog_agent_intro";
import {
  expandStatusFilter,
  type OperatorRunStatusFilter,
} from "@/app/app/workspace_operator/history_filters";
import Link from "next/link";

/**
 * Default landing for /app/workspace_operator — the current user's run
 * history for the active workspace, newest first. The actual table is a
 * client component so it can paginate via the cursor without a full
 * page reload.
 *
 * Filter state lives in URL search params so a refresh preserves the
 * active filter; this page reads those params on the server so the
 * first render already matches the URL.
 */

const VALID_STATUS_BUCKETS = new Set<OperatorRunStatusFilter>([
  "all",
  "completed",
  "failed",
  "cancelled",
  "running",
]);

function pickString(
  v: string | string[] | undefined
): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function parseStatus(
  v: string | string[] | undefined
): OperatorRunStatusFilter {
  const s = pickString(v);
  if (s && VALID_STATUS_BUCKETS.has(s as OperatorRunStatusFilter)) {
    return s as OperatorRunStatusFilter;
  }
  return "all";
}

export default async function WorkspaceOperatorHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const sp = await searchParams;
  const status = parseStatus(sp.status);
  const fromDate = pickString(sp.from)?.trim() || undefined;
  const toDate = pickString(sp.to)?.trim() || undefined;
  const search = pickString(sp.q)?.trim() || undefined;

  const initial = await listOperatorRuns(supabase, {
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    limit: 25,
    status: expandStatusFilter(status),
    fromDate,
    toDate,
    search,
  });

  // Server captures `now` once and passes it to the client; the
  // formatRelativeDate helper requires an explicit `now` so the server
  // and client renders agree during hydration.
  const nowIso = new Date().toISOString();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="bg-background">
        <div className="flex items-start justify-between gap-2 px-6 pt-6 pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              AI
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              History of your Pog runs in this workspace.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/app/workspace_operator/prompts"
              className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground hover:bg-muted"
            >
              Saved prompts
            </Link>
            <OperatorNewRunButton />
          </div>
        </div>
        <Separator />
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <PogAgentIntro />
          <OperatorHistoryTable
            initialRows={initial.rows}
            initialCursor={initial.nextCursor}
            nowIso={nowIso}
            initialFilters={{
              status,
              fromDate: fromDate ?? "",
              toDate: toDate ?? "",
              search: search ?? "",
            }}
          />
        </div>
      </div>
    </div>
  );
}
