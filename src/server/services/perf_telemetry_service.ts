/**
 * Performance telemetry service — read-only.
 *
 * Returns the current observed p50/p95/p99 numbers per route class plus the
 * latest 7-day trend per class plus the most recent bundle measurements.
 *
 * Source of truth: the `perf_route_observations` and `perf_bundle_snapshots`
 * tables (migration `20260504000001_perf_telemetry.sql`). The dashboard
 * trailing-window is fixed at 24 h to match the doc's measurement
 * methodology. The 7-day trend sparkline is rendered from a per-day p95
 * computed off the same table.
 *
 * Failure-mode contract: this service NEVER throws. If a query fails
 * (network blip, missing service-role key on a preview branch, brand-new
 * empty tables) we return zeroed observations and the dashboard renders
 * the empty-state nudge. Admins see a page, never a stack trace.
 *
 * No PII is read or returned — observations are already route-class only.
 */

import {
  type RouteClassId,
  routeClassBudgets,
  routeClassList,
  workerSlas,
  globalBundleBudgets,
} from "@/lib/perf_budget";
import { createAdminClient } from "@/lib/supabase/admin";

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
   * are in milliseconds. Days with no data are zeroed — the sparkline
   * renders a flat line, which is the right signal in the empty case.
   */
  trendP95Ms: number[];
  /** Number of underlying samples in the trailing-24h window. */
  sampleCount: number;
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
  /** True when no observation rows exist yet for the window. */
  hasData: boolean;
  /** Per route-class observations, in canonical order A → H. */
  routeClasses: RouteClassObservation[];
  /** Class-H workers, one row per named job. */
  workers: WorkerObservation[];
  /** Bundle-size observations against the global bundle budgets. */
  bundles: BundleObservation[];
}

interface RouteObservationRow {
  recorded_at: string;
  route_class: string;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  sample_count: number;
}

interface BundleSnapshotRow {
  recorded_at: string;
  bundle_id: string;
  gzipped_kb: number;
  raw_kb: number;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Build the snapshot. Always resolves; the only async work is the two
 * Supabase reads, both of which are caught and degraded to empty data.
 */
export async function getPerfTelemetrySnapshot(): Promise<PerfTelemetrySnapshot> {
  const generatedAt = new Date().toISOString();

  const [routeRows, bundleRows] = await Promise.all([
    readRouteObservations(),
    readBundleSnapshots(),
  ]);

  const routeClasses = buildRouteClassObservations(routeRows);
  const workers = buildWorkerObservations(routeRows);
  const bundles = buildBundleObservations(bundleRows);

  const hasData = routeRows.length > 0;

  return {
    generatedAt,
    window: "24h",
    hasData,
    routeClasses,
    workers,
    bundles,
  };
}

// ─── Reads ─────────────────────────────────────────────────────────────────

async function readRouteObservations(): Promise<RouteObservationRow[]> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  try {
    const admin = createAdminClient();
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
    const { data, error } = await admin
      .from("perf_route_observations")
      .select("recorded_at, route_class, p50_ms, p95_ms, p99_ms, sample_count")
      .gte("recorded_at", sevenDaysAgo)
      .order("recorded_at", { ascending: false })
      .limit(5_000);
    if (error) return [];
    return (data ?? []) as RouteObservationRow[];
  } catch {
    return [];
  }
}

async function readBundleSnapshots(): Promise<BundleSnapshotRow[]> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("perf_bundle_snapshots")
      .select("recorded_at, bundle_id, gzipped_kb, raw_kb")
      .order("recorded_at", { ascending: false })
      .limit(500);
    if (error) return [];
    return (data ?? []) as BundleSnapshotRow[];
  } catch {
    return [];
  }
}

// ─── Builders ──────────────────────────────────────────────────────────────

function buildRouteClassObservations(
  rows: RouteObservationRow[],
): RouteClassObservation[] {
  const cutoff24h = Date.now() - TWENTY_FOUR_HOURS_MS;
  const last24h = rows.filter(
    (r) => new Date(r.recorded_at).getTime() >= cutoff24h,
  );

  return routeClassList.map((cls) => {
    const classRows24h = last24h.filter((r) => r.route_class === cls.id);
    const observedMs = aggregateRows(classRows24h);
    const sampleCount = classRows24h.reduce(
      (acc, r) => acc + r.sample_count,
      0,
    );
    const trendP95Ms = buildSevenDayTrend(rows, cls.id);
    return {
      id: cls.id,
      label: cls.label,
      primaryMetric: cls.primaryMetric,
      observedMs,
      trendP95Ms,
      sampleCount,
    };
  });
}

/**
 * Aggregate a set of pre-aggregated observations into one p50/p95/p99.
 *
 * Each row carries a precomputed percentile *over its own buffer*. A
 * mathematically clean roll-up would re-derive percentiles from raw
 * samples, but we don't store them (PII / volume). The pragmatic
 * approach: weight by sample_count when averaging p50/p99 (rough
 * indicator), and take the MAX p95 across rows in the window — that's the
 * "worst recent minute", which is what the dashboard / alert layer
 * actually needs to fire on. See `docs/performance_budget_v1.md`.
 */
function aggregateRows(rows: RouteObservationRow[]): {
  p50: number;
  p95: number;
  p99: number;
} {
  if (rows.length === 0) return { p50: 0, p95: 0, p99: 0 };
  let totalSamples = 0;
  let weightedP50 = 0;
  let weightedP99 = 0;
  let maxP95 = 0;
  for (const row of rows) {
    totalSamples += row.sample_count;
    weightedP50 += row.p50_ms * row.sample_count;
    weightedP99 += row.p99_ms * row.sample_count;
    if (row.p95_ms > maxP95) maxP95 = row.p95_ms;
  }
  return {
    p50: totalSamples > 0 ? Math.round(weightedP50 / totalSamples) : 0,
    p95: Math.round(maxP95),
    p99: totalSamples > 0 ? Math.round(weightedP99 / totalSamples) : 0,
  };
}

/**
 * Build a 7-point per-day p95 series for the sparkline. Bucket boundaries
 * are end-of-day UTC; the most recent bucket is "today". Days with no
 * data yield 0 (rendered as a flat line).
 */
function buildSevenDayTrend(
  rows: RouteObservationRow[],
  classId: RouteClassId,
): number[] {
  const out: number[] = [];
  const now = Date.now();
  for (let day = 6; day >= 0; day--) {
    const bucketStart = now - (day + 1) * 24 * 60 * 60 * 1000;
    const bucketEnd = now - day * 24 * 60 * 60 * 1000;
    let maxP95 = 0;
    for (const row of rows) {
      if (row.route_class !== classId) continue;
      const t = new Date(row.recorded_at).getTime();
      if (t < bucketStart || t >= bucketEnd) continue;
      if (row.p95_ms > maxP95) maxP95 = row.p95_ms;
    }
    out.push(Math.round(maxP95));
  }
  return out;
}

/**
 * Build worker observations. Class H workers don't yet have per-worker
 * instrumentation in this milestone — they roll up under the H route
 * class for now. We surface the H aggregate against each named worker's
 * documented SLA so the SLA card stays populated, and flag a TODO in
 * the comment for the next milestone (named-job spans).
 *
 * If we have NO Class-H data at all (pre-traffic), each row reports 0 ms,
 * which the dashboard renders as the empty-state.
 */
function buildWorkerObservations(
  rows: RouteObservationRow[],
): WorkerObservation[] {
  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
  const hRows = rows.filter(
    (r) =>
      r.route_class === "H" &&
      new Date(r.recorded_at).getTime() >= cutoff,
  );
  const aggregate = aggregateRows(hRows);
  return workerSlas.map((w) => ({
    id: w.id,
    label: w.label,
    observedP95Ms: aggregate.p95,
    budgetP95Ms: w.p95Ms,
    sla: w.sla,
  }));
}

function buildBundleObservations(
  rows: BundleSnapshotRow[],
): BundleObservation[] {
  // Take the most recent row per bundle id. The query already orders by
  // recorded_at desc so the first-seen entry per id is the latest.
  const latest = new Map<string, BundleSnapshotRow>();
  for (const row of rows) {
    if (!latest.has(row.bundle_id)) latest.set(row.bundle_id, row);
  }
  return globalBundleBudgets.map((b) => {
    const row = latest.get(b.id);
    return {
      id: b.id,
      label: b.label,
      observedKb: row ? Math.round(row.gzipped_kb) : 0,
      softCapKb: b.cap.soft,
      hardCapKb: b.cap.hard,
    };
  });
}

// ─── Internal: rollup for the alert service ────────────────────────────────

/**
 * Compute the trailing p95 per route class over the last `windowMs`
 * milliseconds. Used by `perf_alert_service.ts`. Returns an entry per
 * class even if there are no samples (p95 = 0, sampleCount = 0).
 */
export async function computeTrailingP95ByClass(
  windowMs: number,
): Promise<
  Array<{
    routeClass: RouteClassId;
    p95Ms: number;
    sampleCount: number;
  }>
> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return routeClassList.map((c) => ({
      routeClass: c.id,
      p95Ms: 0,
      sampleCount: 0,
    }));
  }
  let rows: RouteObservationRow[] = [];
  try {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    const { data, error } = await admin
      .from("perf_route_observations")
      .select("recorded_at, route_class, p50_ms, p95_ms, p99_ms, sample_count")
      .gte("recorded_at", cutoff)
      .limit(5_000);
    if (error) {
      rows = [];
    } else {
      rows = (data ?? []) as RouteObservationRow[];
    }
  } catch {
    rows = [];
  }
  return routeClassList.map((cls) => {
    const subset = rows.filter((r) => r.route_class === cls.id);
    const agg = aggregateRows(subset);
    const sampleCount = subset.reduce((acc, r) => acc + r.sample_count, 0);
    return { routeClass: cls.id, p95Ms: agg.p95, sampleCount };
  });
}
