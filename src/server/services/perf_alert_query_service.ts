/**
 * Read-side companion to `perf_alert_service.ts` — exposes the unresolved
 * alert list to the admin dashboard. Kept separate so the dashboard
 * doesn't pull the writer's Sentry import into its render bundle.
 */

import type { RouteClassId } from "@/lib/perf_budget";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PerfAlertRow {
  id: string;
  raisedAt: string;
  routeClass: RouteClassId;
  observedP95Ms: number;
  budgetP95Ms: number;
  reason: string;
}

interface AlertRow {
  id: string;
  raised_at: string;
  route_class: string;
  observed_p95_ms: number;
  budget_p95_ms: number;
  reason: string;
}

/**
 * List unresolved alerts, newest first, capped at 50. Always resolves —
 * an empty array is the right empty state.
 */
export async function listUnresolvedPerfAlerts(): Promise<PerfAlertRow[]> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("perf_alerts")
      .select("id, raised_at, route_class, observed_p95_ms, budget_p95_ms, reason")
      .is("resolved_at", null)
      .order("raised_at", { ascending: false })
      .limit(50);
    if (error) return [];
    return ((data ?? []) as AlertRow[]).map((row) => ({
      id: row.id,
      raisedAt: row.raised_at,
      routeClass: row.route_class as RouteClassId,
      observedP95Ms: row.observed_p95_ms,
      budgetP95Ms: row.budget_p95_ms,
      reason: row.reason,
    }));
  } catch {
    return [];
  }
}
