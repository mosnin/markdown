// Soft-archived behind the `advanced_surfaces` feature flag (Move 4):
// default-tier users are redirected to /app; enterprise admins keep access.
import {
  Bot,
  GitFork,
  Slash,
  Sparkles,
  Zap,
} from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { requireAdvancedSurfaces } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import {
  formatCents,
  getWorkspaceUsageSummary,
  sumThisMonth,
  type UsageCategory,
} from "@/server/services/usage_summary_service";
import { PageHeader } from "@/components/product/page_header";
import { UsageBreakdownTable } from "@/components/product/usage_breakdown_table";
import { UsageSparkChart } from "@/components/product/usage_spark_chart";
import { formatRelativeDateShort } from "@/lib/format_date";
import { cn } from "@/lib/utils";

export default async function UsageDashboardPage() {
  // Freeze "now" at render so the time-ago strings produced by
  // formatRelativeDateShort match between server render and hydration —
  // see src/lib/format_date.ts.
  const nowIso = new Date().toISOString();

  const ctx = await requireAuthenticatedUser();
  await requireAdvancedSurfaces(ctx);
  const supabase = await createClient();

  const summary = await getWorkspaceUsageSummary(supabase, ctx.workspace.id);
  const thisMonthCents = sumThisMonth(summary.dailySpend);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Usage & cost"
        description="Aggregate spend across every AI surface in this workspace — operator runs, sub-agents, workflows, and inline commands."
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 md:px-6">
          {/* ── Stat cards ──────────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label="Total spend"
              value={formatCents(summary.totalCostCents)}
              hint="Across the last 30 days"
            />
            <StatCard
              label="Total runs"
              value={summary.totalRuns.toLocaleString("en-US")}
              hint="Across all categories"
            />
            <StatCard
              label="This month"
              value={formatCents(thisMonthCents)}
              hint="Calendar-month spend"
              accent
            />
          </div>

          {/* ── Daily spend chart ───────────────────────────────────── */}
          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              Daily spend
            </h2>
            <UsageSparkChart
              daily={summary.dailySpend}
              caption="Last 30 days"
            />
          </section>

          {/* ── Breakdown by category ───────────────────────────────── */}
          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              By category
            </h2>
            <UsageBreakdownTable rows={summary.byCategory} />
          </section>

          {/* ── Recent activity ─────────────────────────────────────── */}
          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              Recent activity
            </h2>
            {summary.recentRuns.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No recent runs in this workspace yet.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5 list-none">
                {summary.recentRuns.map((run) => (
                  <li key={`${run.category}-${run.id}`}>
                    <RecentRunRow run={run} nowIso={nowIso} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3",
        accent && "border-emerald-500/40 bg-emerald-500/5"
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-2xl font-semibold tabular-nums tracking-tight",
          accent ? "text-emerald-700 dark:text-emerald-400" : "text-foreground"
        )}
      >
        {value}
      </span>
      {hint && (
        <span className="text-[11px] text-muted-foreground/70">{hint}</span>
      )}
    </div>
  );
}

// ─── RecentRunRow ─────────────────────────────────────────────────────────────

const CATEGORY_META: Record<
  UsageCategory,
  { icon: React.ElementType; label: string; tone: string }
> = {
  operator: {
    icon: Bot,
    label: "Atlas AI",
    tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  subagent: {
    icon: Sparkles,
    label: "Sub-agent",
    tone: "bg-brand-500/10 text-brand-700 dark:text-brand-300",
  },
  workflow: {
    icon: GitFork,
    label: "Workflow",
    tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  inline_command: {
    icon: Slash,
    label: "Command",
    tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  trigger: {
    icon: Zap,
    label: "Trigger",
    tone: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
};

function RecentRunRow({
  run,
  nowIso,
}: {
  run: {
    id: string;
    category: UsageCategory;
    label: string;
    startedAt: string;
    status: string;
    costCents: number;
  };
  nowIso: string;
}) {
  const meta = CATEGORY_META[run.category];
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
          meta.tone
        )}
      >
        <Icon className="h-2.5 w-2.5" aria-hidden="true" />
        {meta.label}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
        {run.label || "Untitled"}
      </span>
      <span
        className={cn(
          "shrink-0 text-[11px]",
          run.status === "completed" && "text-emerald-600 dark:text-emerald-400",
          run.status === "failed" && "text-rose-600 dark:text-rose-400",
          (run.status === "running" || run.status === "queued") &&
            "text-blue-600 dark:text-blue-400",
          run.status === "cancelled" && "text-muted-foreground"
        )}
      >
        {run.status}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {formatRelativeDateShort(run.startedAt, nowIso)}
      </span>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-foreground">
        {run.costCents > 0 ? (
          formatCents(run.costCents)
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
      </span>
    </div>
  );
}
