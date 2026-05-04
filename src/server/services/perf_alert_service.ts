/**
 * Performance alert service.
 *
 * Walks the trailing-1h p95 per route class and raises an alert when any
 * class lands in the `red` (`fail`) tier per `classifyLatency`. The check
 * is idempotent within a 6 h window per class — if there is already an
 * unresolved alert raised in the last 6 h for the same class, we skip;
 * otherwise we INSERT a new row and capture a Sentry warning.
 *
 * Scheduling: this module exposes a function that is invoked from the
 * Inngest cron defined in `src/lib/inngest/functions/check_perf_alerts.ts`.
 * Inngest is the codebase's existing scheduler (see
 * `execute_scheduled_triggers.ts` and `clear_stuck_trigger_runs.ts`); we
 * stay on that surface rather than introducing pg_cron.
 *
 * No PII is read or sent — only the route-class label.
 */

import * as Sentry from "@sentry/nextjs";

import {
  classifyLatency,
  routeClassBudgets,
  routeClassList,
  type RouteClassId,
} from "@/lib/perf_budget";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeTrailingP95ByClass } from "@/server/services/perf_telemetry_service";

const ONE_HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export interface PerfAlertCheckResult {
  /** Number of route classes evaluated. */
  evaluated: number;
  /** Number of fresh alerts inserted. */
  raised: number;
  /** Number of red-tier classes skipped due to the 6 h dedupe window. */
  suppressed: number;
}

/**
 * One pass over every route class. Idempotent within the dedupe window
 * — safe to call from a cron fired every minute (it will simply do
 * nothing for the next 6 h once an alert is up for a given class).
 */
export async function checkPerfAlerts(): Promise<PerfAlertCheckResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { evaluated: 0, raised: 0, suppressed: 0 };
  }

  const admin = createAdminClient();
  const summary = await computeTrailingP95ByClass(ONE_HOUR_MS);

  // Pull the most recent unresolved alert per class so we can apply the
  // 6 h dedupe in one round trip rather than per-class.
  const dedupeCutoffIso = new Date(Date.now() - SIX_HOURS_MS).toISOString();
  const { data: recentAlerts, error: alertReadErr } = await admin
    .from("perf_alerts")
    .select("route_class, raised_at, resolved_at")
    .gte("raised_at", dedupeCutoffIso);
  if (alertReadErr) {
    // Failing the read should not crash the cron — treat as "no recent
    // alerts" and proceed; worst case we double-fire once.
    Sentry.captureException(alertReadErr, {
      tags: { component: "perf_alert_service", phase: "read_recent_alerts" },
    });
  }

  const recentByClass = new Map<RouteClassId, { resolved: boolean }>();
  for (const row of recentAlerts ?? []) {
    const cls = row.route_class as RouteClassId;
    // Only the most recent matters for dedupe; we keep the first-seen
    // entry (rows aren't sorted but presence-of-any is all we need).
    if (!recentByClass.has(cls)) {
      recentByClass.set(cls, { resolved: row.resolved_at !== null });
    }
  }

  let raised = 0;
  let suppressed = 0;

  for (const entry of summary) {
    if (entry.sampleCount === 0) continue; // No data — don't fire.
    const budget = routeClassBudgets[entry.routeClass].latency.p95;
    const status = classifyLatency(entry.p95Ms, budget);
    if (status !== "fail") continue;

    const existing = recentByClass.get(entry.routeClass);
    if (existing && !existing.resolved) {
      suppressed += 1;
      continue;
    }

    const ratio = entry.p95Ms / budget;
    const reason = `Class ${entry.routeClass} (${routeClassBudgets[entry.routeClass].label}) p95 ${entry.p95Ms} ms exceeds budget ${budget} ms by ${ratio.toFixed(2)}x over the last hour.`;

    const { error: insertErr } = await admin
      .from("perf_alerts")
      .insert({
        route_class: entry.routeClass,
        observed_p95_ms: entry.p95Ms,
        budget_p95_ms: budget,
        reason,
      });
    if (insertErr) {
      Sentry.captureException(insertErr, {
        tags: {
          component: "perf_alert_service",
          phase: "insert_alert",
          route_class: entry.routeClass,
        },
      });
      continue;
    }

    // Sentry warning so on-call sees the regression even if no human is
    // looking at the dashboard. PII-free — only route-class + numbers.
    Sentry.captureMessage(reason, {
      level: "warning",
      tags: {
        component: "perf_alert_service",
        route_class: entry.routeClass,
      },
      extra: {
        observed_p95_ms: entry.p95Ms,
        budget_p95_ms: budget,
        ratio_over_budget: ratio,
        sample_count: entry.sampleCount,
      },
    });

    raised += 1;
  }

  return {
    evaluated: routeClassList.length,
    raised,
    suppressed,
  };
}
