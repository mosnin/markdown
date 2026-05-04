/**
 * Performance telemetry service — read-only.
 *
 * Returns the current observed p50/p95/p99 numbers per route class plus the
 * latest 7-day trend per class plus the most recent bundle measurements.
 *
 * --------------------------------------------------------------------------
 * Production telemetry plumbing (not yet wired)
 * --------------------------------------------------------------------------
 *
 * Today this is a deterministic stub so the admin dashboard renders
 * meaningful numbers in dev and on staging. The real implementation will
 * compose three sources:
 *
 *   1. **Sentry tracing API** (`https://sentry.io/api/0/.../events-stats/`)
 *      — primary source for server-render TTFB, server-action latency,
 *      and span-level p50/p95/p99 across a rolling window. We tag every
 *      span with `route_class` (one of A–H) at instrumentation time
 *      (`src/instrumentation.ts`); the server query is a single
 *      `groupBy=route_class` aggregation.
 *
 *   2. **Vercel Analytics export** — primary source for client web vitals
 *      (LCP, INP, CLS) and TTFB at the edge. The `pages` payload arrives
 *      as a per-route JSON; we map each route to its class via
 *      `routeClassFor(pathname)` (helper to be added next to this file).
 *
 *   3. **Internal worker metrics table** (`worker_runs` in Supabase, fed
 *      by Inngest step instrumentation) — for Class H jobs. The dashboard
 *      reads p95 duration per `worker_kind` over the last 24h.
 *
 * Production shape we will return (kept identical to the stub so the UI
 * doesn't change when we flip the feed):
 *
 *   ```ts
 *   interface PerfTelemetrySnapshot {
 *     generatedAt: string;          // ISO timestamp, "as of"
 *     window: "24h" | "7d" | "28d"; // which rolling window was used
 *     routeClasses: RouteClassObservation[];
 *     workers: WorkerObservation[];
 *     bundles: BundleObservation[];
 *   }
 *   ```
 *
 * Caching: production calls Sentry / Vercel Analytics on a 5-minute swr
 * via `unstable_cache` keyed on workspace_id (no PII in the response, so
 * this is shareable across admins).
 *
 * Failure mode: if any source 5xxs, the service returns the last good
 * snapshot from `perf_snapshots` (a small table we'll create in
 * `supabase/migrations`) with a `stale: true` flag the dashboard surfaces
 * inline. The admin sees data, not a broken page.
 *
 * Open questions to flag in the rollout PR:
 *
 *   - Do we keep the Sentry SDK pull (server-side) or push to Sentry's
 *     Stats API (client-side)? Server-side is simpler but rate-limited.
 *   - Should the dashboard window be configurable (24h / 7d / 28d) or
 *     fixed at 7d to match the doc's measurement methodology?
 *   - Do we surface per-route observations (not just per-class) in a
 *     drill-down? Worth its own ticket — the dashboard stays per-class
 *     in v1 to keep the page legible.
 */

import {
  type RouteClassId,
  routeClassBudgets,
  routeClassList,
  workerSlas,
  globalBundleBudgets,
} from "@/lib/perf_budget";

/** A single percentile observation for a route class. */
export interface RouteClassObservation {
  id: RouteClassId;
  label: string;
  /** Primary metric label, e.g. "TTFB", "Action latency". */
  primaryMetric: string;
  /** Observed milliseconds for the primary metric. */
  observedMs: { p50: number; p95: number; p99: number };
  /**
   * Last 7 daily p95 samples (oldest first), for the sparkline. Numbers
   * are in milliseconds. Production: rolling-window query against Sentry.
   */
  trendP95Ms: number[];
}

/** Per-worker observation — Class H break-down. */
export interface WorkerObservation {
  id: string;
  label: string;
  observedP95Ms: number;
  budgetP95Ms: number;
  sla: string;
}

/** Per-bundle observation — chunk size in KB. */
export interface BundleObservation {
  id: string;
  label: string;
  observedKb: number;
  softCapKb: number;
  hardCapKb: number;
}

export interface PerfTelemetrySnapshot {
  /** ISO timestamp the data was generated. */
  generatedAt: string;
  /** Rolling window the numbers reflect. */
  window: "24h" | "7d" | "28d";
  /** Per route-class observations, in canonical order A → H. */
  routeClasses: RouteClassObservation[];
  /** Class-H workers, one row per named job. */
  workers: WorkerObservation[];
  /** Bundle-size observations against the global bundle budgets. */
  bundles: BundleObservation[];
}

/**
 * Stub: returns plausible numbers within ±20% of the documented budgets so
 * the admin dashboard is meaningful before the real telemetry is wired.
 * Numbers are deterministic per route class — re-renders don't churn the
 * UI mid-debug.
 */
export async function getPerfTelemetrySnapshot(): Promise<PerfTelemetrySnapshot> {
  // Use a fixed reference timestamp (start of day, UTC) so server / client
  // renders match for the dev case. Production will use Date.now().
  const now = new Date();
  const generatedAt = now.toISOString();

  const routeClasses: RouteClassObservation[] = routeClassList.map((cls) => {
    // Per-class deterministic offsets, ranging from -15% to +18% of the
    // budget at p95. Spread across green / amber territory; one class
    // (E — detail pages) intentionally lands amber so the colour coding
    // is visible in the demo.
    const offsetByClass: Record<RouteClassId, number> = {
      A: -0.10, // 10% under budget
      B: -0.05, // 5% under
      C: +0.04, // 4% over (still ok — within budget? no, it's over but <20%)
      D: -0.08,
      E: +0.16, // 16% over — amber/warn
      F: -0.12,
      G: -0.03,
      H: +0.06,
    };
    const offset = offsetByClass[cls.id];
    const p95 = round(cls.latency.p95 * (1 + offset));
    const p50 = round(cls.latency.p50 * (1 + offset * 0.7));
    const p99 = round(cls.latency.p99 * (1 + offset * 0.5));

    return {
      id: cls.id,
      label: cls.label,
      primaryMetric: cls.primaryMetric,
      observedMs: { p50, p95, p99 },
      trendP95Ms: makeTrend(cls.latency.p95, offset, cls.id),
    };
  });

  const workers: WorkerObservation[] = workerSlas.map((w, i) => {
    // Mostly green with one amber (webhook delivery) so the SLA card
    // colour-codes meaningfully.
    const offsets = [-0.10, -0.05, +0.18, -0.20, +0.02];
    const offset = offsets[i % offsets.length];
    return {
      id: w.id,
      label: w.label,
      observedP95Ms: round(w.p95Ms * (1 + offset)),
      budgetP95Ms: w.p95Ms,
      sla: w.sla,
    };
  });

  const bundles: BundleObservation[] = globalBundleBudgets.map((b, i) => {
    const offsets = [-0.05, +0.08, +0.30, -0.10]; // shell warn-band, per-page hard-fail
    const offset = offsets[i % offsets.length];
    const observedKb = Math.max(1, round(b.cap.soft * (1 + offset)));
    return {
      id: b.id,
      label: b.label,
      observedKb,
      softCapKb: b.cap.soft,
      hardCapKb: b.cap.hard,
    };
  });

  return {
    generatedAt,
    window: "7d",
    routeClasses,
    workers,
    bundles,
  };
}

/**
 * Build a 7-point trend that wiggles around the budget. Deterministic per
 * class so the sparkline doesn't churn between requests. The latest point
 * matches the observation's p95 exactly so the dashboard's "latest dot"
 * lines up with the table number.
 */
function makeTrend(
  budgetMs: number,
  finalOffset: number,
  classId: RouteClassId,
): number[] {
  // Seven days, oldest first. Use a small per-class phase offset to make
  // each sparkline visually distinct.
  const phase = classId.charCodeAt(0); // 65..72
  const points: number[] = [];
  for (let day = 0; day < 7; day++) {
    if (day === 6) {
      // Final point matches the observed p95 exactly.
      points.push(round(budgetMs * (1 + finalOffset)));
      continue;
    }
    // Wiggle ±10% around budget with a class-specific phase.
    const wiggle = Math.sin((day + phase) * 0.9) * 0.1;
    points.push(round(budgetMs * (1 + wiggle)));
  }
  return points;
}

function round(n: number): number {
  // Round to 1 ms for legibility — sub-ms precision is noise at this layer.
  return Math.round(n);
}

/**
 * Production-only helper sketch (commented intentionally — not used today).
 *
 * ```ts
 * function routeClassFor(pathname: string): RouteClassId {
 *   if (pathname.startsWith("/(marketing)") || pathname === "/") return "A";
 *   if (/^\/(sign_in|reset-password|oauth|capture|share|welcome|invite)/.test(pathname)) return "B";
 *   if (pathname === "/app") return "C";
 *   if (/^\/app\/(skills|agents|workflows|branches|proposals|audit|activity|insights)$/.test(pathname)) return "D";
 *   if (/^\/app\/(notes|files|agents|boxes|skills|folders|runs)\//.test(pathname)) return "E";
 *   if (pathname.startsWith("/api/v1")) return "G";
 *   // Server-action class (F) is per-span, not per-route — see
 *   // `instrumentation.ts` for span tagging.
 *   return "C"; // default to shell so we never miscount
 * }
 * ```
 */
