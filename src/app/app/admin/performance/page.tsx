import { redirect } from "next/navigation";
import Link from "next/link";
import { Activity, AlertTriangle, ExternalLink, Inbox } from "lucide-react";

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { canAdmin } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import {
  classifyBundle,
  classifyLatency,
  routeClassBudgets,
  type BudgetStatus,
} from "@/lib/perf_budget";
import {
  getPerfTelemetrySnapshot,
  type RouteClassObservation,
} from "@/server/services/perf_telemetry_service";
import {
  listUnresolvedPerfAlerts,
  type PerfAlertRow,
} from "@/server/services/perf_alert_query_service";
import {
  getPullTokenActivitySummary,
  type PullTokenActivitySummary,
} from "@/server/services/pull_token_service";

import { PageHeader } from "@/components/product/page_header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import { resolvePerfAlertFormAction } from "./actions";

/**
 * Live performance dashboard — admin-only.
 *
 * Renders the current p50/p95/p99 per route class against the budget
 * defined in `src/lib/perf_budget.ts`, a 7-day p95 trend sparkline per
 * class, the bundle-size table, the background-worker SLA card, and a
 * "How budgets work" explainer linking to the canonical doc.
 *
 * Numbers are read from `perf_route_observations` and
 * `perf_bundle_snapshots` (migration `20260504000001_perf_telemetry.sql`).
 * The page renders even when those tables are empty — the empty-state
 * card explains that telemetry will appear within 24 h of first traffic.
 */
export default async function AdminPerformancePage() {
  const ctx = await requireAuthenticatedUser();

  if (!canAdmin(ctx.workspace.role)) {
    redirect("/app");
  }

  const supabase = await createClient();
  const [snapshot, alerts, pullActivity] = await Promise.all([
    getPerfTelemetrySnapshot(),
    listUnresolvedPerfAlerts(),
    // Pull-token activity is best-effort; the tile renders an empty
    // state if the service throws (e.g. before the migration lands).
    getPullTokenActivitySummary(supabase, ctx.workspace.id).catch(
      () => null as PullTokenActivitySummary | null
    ),
  ]);

  const generatedAtLabel = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(snapshot.generatedAt));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Performance"
        description="Live latency, bundle size, and worker SLA against the v1 performance budget."
        actions={
          <Button variant="outline" size="sm" render={<Link href="/app/admin/performance" />}>
            <Activity aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-5xl space-y-6 px-6 py-6 md:px-8">
          {/* As-of caption */}
          <p className="text-xs text-muted-foreground">
            Rolling {snapshot.window} window. As of{" "}
            <span className="font-mono tabular-nums">{generatedAtLabel} UTC</span>.
          </p>

          {/* ── Active alerts ──────────────────────────────────────── */}
          <ActiveAlertsCard alerts={alerts} />

          {/* ── Empty state when no telemetry has arrived ──────────── */}
          {!snapshot.hasData ? <EmptyTelemetryCard /> : null}

          {/* ── Route-class table with sparklines ───────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Route-class latency</CardTitle>
              <CardDescription>
                Primary-metric p50 / p95 / p99 against the documented budget over the
                last 24 h. Green is at or under budget, amber is up to 20% over, red is
                a CI-blocking regression.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="px-0 pt-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium">Class</th>
                    <th className="px-3 py-2.5 font-medium">Metric</th>
                    <th className="px-3 py-2.5 text-right font-medium">p50</th>
                    <th className="px-3 py-2.5 text-right font-medium">p95</th>
                    <th className="px-3 py-2.5 text-right font-medium">Budget p95</th>
                    <th className="px-3 py-2.5 text-right font-medium">p99</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5 font-medium">7-day trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {snapshot.routeClasses.map((row) => (
                    <RouteClassRow key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* ── Bundles + Workers (two-up) ──────────────────────────── */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Bundle sizes</CardTitle>
                <CardDescription>
                  Latest chunk sizes from the most recent CI run, against the soft /
                  hard cap from the doc.
                </CardDescription>
              </CardHeader>
              <Separator />
              <CardContent className="px-0 pt-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-5 py-2.5 font-medium">Bundle</th>
                      <th className="px-3 py-2.5 text-right font-medium">Size</th>
                      <th className="px-3 py-2.5 text-right font-medium">Soft</th>
                      <th className="px-3 py-2.5 text-right font-medium">Hard</th>
                      <th className="px-5 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {snapshot.bundles.map((b) => {
                      const status = classifyBundle(b.observedKb, {
                        soft: b.softCapKb,
                        hard: b.hardCapKb,
                      });
                      return (
                        <tr key={b.id}>
                          <td className="px-5 py-2.5 font-medium text-foreground">
                            {b.label}
                          </td>
                          <td className={cn(
                            "px-3 py-2.5 text-right font-mono tabular-nums",
                            statusTextClass(status),
                          )}>
                            {b.observedKb} KB
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                            {b.softCapKb} KB
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                            {b.hardCapKb} KB
                          </td>
                          <td className="px-5 py-2.5">
                            <StatusBadge status={status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Background workers</CardTitle>
                <CardDescription>
                  Class H — embedding, diff, webhook delivery, retention, KG extraction.
                  Trailing 24 h.
                </CardDescription>
              </CardHeader>
              <Separator />
              <CardContent className="px-0 pt-0">
                <ul className="divide-y divide-border">
                  {snapshot.workers.map((w) => {
                    const status = classifyLatency(w.observedP95Ms, w.budgetP95Ms);
                    return (
                      <li
                        key={w.id}
                        className="flex items-start justify-between gap-4 px-5 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">
                            {w.label}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {w.sla}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className={cn(
                            "font-mono text-sm tabular-nums",
                            statusTextClass(status),
                          )}>
                            {formatMs(w.observedP95Ms)}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            / {formatMs(w.budgetP95Ms)}
                          </span>
                          <StatusBadge status={status} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* ── Pull-token activity (read-only tile) ──────────────────── */}
          <PullTokenActivityTile activity={pullActivity} />

          {/* ── How budgets work ────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>How budgets work</CardTitle>
              <CardDescription>
                Budgets are the merge gate, not aspirations. CI fails when a route
                class&apos; p95 exceeds the budget by more than 20%, or when a bundle
                exceeds its hard cap. Budgets are reviewed quarterly and tightened
                when we beat them for two cycles running.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="space-y-3 pt-4 text-sm leading-relaxed text-muted-foreground">
              <p>
                <span className="text-success font-medium">Green</span> — at or under
                budget.{" "}
                <span className="text-warning font-medium">Amber</span> — over budget but
                under the +20% regression line.{" "}
                <span className="text-destructive font-medium">Red</span> — past the
                regression line; CI blocks merge.
              </p>
              <p>
                Latency numbers are computed from{" "}
                <code className="font-mono text-xs text-foreground">
                  perf_route_observations
                </code>{" "}
                (sampled at 1% in production, 100% in dev) over the last 24 h. Bundle
                numbers come from{" "}
                <code className="font-mono text-xs text-foreground">
                  perf_bundle_snapshots
                </code>{" "}
                — populated by{" "}
                <code className="font-mono text-xs text-foreground">
                  scripts/bench/check_bundle.ts --persist
                </code>{" "}
                in CI.
              </p>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <a
                      href="/docs/performance_budget_v1.md"
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  Read the full budget
                  <ExternalLink aria-hidden="true" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ActiveAlertsCard({ alerts }: { alerts: PerfAlertRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active alerts</CardTitle>
        <CardDescription>
          Route-class p95 regressions raised over the last hour. Resolve a row once
          the underlying issue has been investigated; the alerter will not re-fire
          for the same class within 6 h.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className={cn("px-0", alerts.length === 0 ? "py-6" : "py-0")}>
        {alerts.length === 0 ? (
          <div className="flex items-start gap-3 px-5">
            <Inbox className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="text-sm text-muted-foreground">
              No active alerts. All route classes are within budget over the last hour.
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className="flex items-start justify-between gap-4 px-5 py-3"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-border text-[10px] font-semibold text-muted-foreground">
                        {alert.routeClass}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        {routeClassBudgets[alert.routeClass].label}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-destructive">
                        p95 {formatMs(alert.observedP95Ms)}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        / {formatMs(alert.budgetP95Ms)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Raised {formatRelative(alert.raisedAt)} —{" "}
                      <span className="font-mono">{alert.reason}</span>
                    </p>
                  </div>
                </div>
                <form action={resolvePerfAlertFormAction} className="shrink-0">
                  <input type="hidden" name="alertId" value={alert.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Mark resolved
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Small read-only tile summarising pull-token activity over the last
 * 24 hours. Lives near the bottom of the perf dashboard so it never
 * competes with the route-class table for attention.
 *
 * Renders a "No data yet" caption when the service is not yet
 * available — Agent A's `getPullTokenActivitySummary` is wrapped in
 * `.catch(() => null)` at the page level for that reason.
 */
function PullTokenActivityTile({
  activity,
}: {
  activity: PullTokenActivitySummary | null;
}) {
  if (!activity) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>Pull-token activity (24 h)</CardTitle>
          <CardDescription>
            Live counts of bundle reads, write proposals, and active tokens
            across the workspace.
          </CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="px-5 py-4 text-sm text-muted-foreground">
          No data yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Pull-token activity (24 h)</CardTitle>
        <CardDescription>
          Bundle reads, write proposals, and active tokens across the workspace.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="space-y-2 px-5 py-4">
        <p className="font-mono text-sm tabular-nums text-foreground">
          <span className="font-semibold">{activity.reads}</span>
          <span className="text-muted-foreground"> reads · </span>
          <span className="font-semibold">{activity.writes}</span>
          <span className="text-muted-foreground"> writes</span>
        </p>
        <p className="font-mono text-sm tabular-nums text-foreground">
          <span className="font-semibold">{activity.activeTokens}</span>
          <span className="text-muted-foreground"> active tokens</span>
        </p>
        <p className="font-mono text-sm tabular-nums">
          <span
            className={cn(
              "font-semibold",
              activity.invalidAttempts > 0 ? "text-warning" : "text-foreground"
            )}
          >
            {activity.invalidAttempts}
          </span>
          <span className="text-muted-foreground"> invalid attempts</span>
        </p>
        <div className="pt-1">
          <Link
            href="/app/audit?filter=pull_links"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
            <ExternalLink className="size-3" aria-hidden="true" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyTelemetryCard() {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 px-5 py-6">
        <Activity className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">No telemetry yet</p>
          <p className="text-sm text-muted-foreground">
            Telemetry will appear within 24 h of first traffic. The dashboard renders
            zeroes for any class without samples — that&apos;s expected on a fresh
            environment.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** "5 min ago" / "2 h ago" — relative format for alert raised-at. */
function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

function RouteClassRow({ row }: { row: RouteClassObservation }) {
  const budget = routeClassBudgets[row.id].latency;
  const status = classifyLatency(row.observedMs.p95, budget.p95);

  return (
    <tr>
      <td className="px-5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-border text-[10px] font-semibold text-muted-foreground">
            {row.id}
          </span>
          <span className="text-sm font-medium text-foreground">{row.label}</span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground">{row.primaryMetric}</td>
      <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums text-muted-foreground">
        {formatMs(row.observedMs.p50)}
      </td>
      <td className={cn(
        "px-3 py-2.5 text-right font-mono text-sm tabular-nums",
        statusTextClass(status),
      )}>
        {formatMs(row.observedMs.p95)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {formatMs(budget.p95)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums text-muted-foreground">
        {formatMs(row.observedMs.p99)}
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge status={status} />
      </td>
      <td className="px-5 py-2.5">
        <Sparkline values={row.trendP95Ms} budget={budget.p95} />
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: BudgetStatus }) {
  if (status === "ok") return <Badge variant="success">On budget</Badge>;
  if (status === "warn") return <Badge variant="warning">Over</Badge>;
  return <Badge variant="destructive">Regression</Badge>;
}

function statusTextClass(status: BudgetStatus): string {
  if (status === "ok") return "text-success";
  if (status === "warn") return "text-warning";
  return "text-destructive";
}

/** Format milliseconds for display. <1000 stays in ms; ≥1000 uses seconds. */
function formatMs(ms: number): string {
  if (ms >= 1000) {
    const seconds = ms / 1000;
    // Trim trailing zero but keep one decimal for sub-10s.
    return seconds >= 10 ? `${seconds.toFixed(0)} s` : `${seconds.toFixed(1)} s`;
  }
  return `${ms} ms`;
}

/**
 * Tiny inline SVG sparkline. Monochrome line in `stroke-muted-foreground`,
 * latest point dotted in brand-yellow. No client JS — renders straight in
 * the server component.
 */
function Sparkline({ values, budget }: { values: number[]; budget: number }) {
  const width = 96;
  const height = 24;
  if (values.length === 0) {
    return <div className="h-6 w-24" aria-hidden="true" />;
  }
  // Scale so the budget line sits at 70% height; values that exceed the
  // budget will visibly poke above the implicit reference.
  const max = Math.max(budget, ...values) * 1.1;
  const min = Math.min(...values, budget * 0.4) * 0.9;
  const range = Math.max(1, max - min);
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;

  const toY = (v: number) => height - ((v - min) / range) * height;

  const points = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${toY(v).toFixed(1)}`)
    .join(" ");

  const lastValue = values[values.length - 1] ?? budget;
  const lastX = (values.length - 1) * stepX;
  const lastY = toY(lastValue);
  const budgetY = toY(budget);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="7-day p95 trend"
      className="overflow-visible"
    >
      {/* Budget reference line — hairline, dashed, at the budget level */}
      <line
        x1={0}
        y1={budgetY}
        x2={width}
        y2={budgetY}
        className="stroke-border"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      {/* Trend line */}
      <polyline
        fill="none"
        points={points}
        className="stroke-muted-foreground"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Latest point — brand-yellow dot */}
      <circle
        cx={lastX}
        cy={lastY}
        r={2.25}
        className="fill-brand"
      />
    </svg>
  );
}
