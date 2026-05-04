/**
 * Route-latency instrumentation.
 *
 * Records per-request duration for `/app/**` (and other matched) routes,
 * keyed by route class (A–H from `classifyRoute`). Samples are buffered
 * in-process and flushed to Supabase via the service-role admin client
 * either every {@link FLUSH_INTERVAL_MS} milliseconds or whenever the
 * buffer reaches {@link FLUSH_BATCH_SIZE} rows.
 *
 * PII contract — STRICT:
 *   - We record ONLY the route-class label (one of "A".."H").
 *   - We never record the raw pathname, the user id, the workspace id,
 *     query params, or any header.
 *   - The Supabase row mirrors that contract — see migration
 *     `20260504000001_perf_telemetry.sql`.
 *
 * Sampling:
 *   - 100% in dev (`NODE_ENV !== "production"`).
 *   - 1% in prod, env-toggleable via `PERF_TELEMETRY_SAMPLE_RATE` (a
 *     decimal between 0 and 1; out-of-range values fall back to 0.01).
 *   - Set to 0 to disable entirely (e.g. for previews).
 *
 * The flusher computes p50 / p95 / p99 over the buffered samples per route
 * class and writes ONE row per class per flush; the dashboard service then
 * rolls those rows up into the trailing 24h window.
 *
 * This module is safe to import from edge runtime — the `setInterval`
 * timer is started lazily on first observation, so static analysis of the
 * edge bundle doesn't drag in the timer at module load.
 */

import { classifyRoute, type RouteClassId } from "@/lib/perf_budget";

interface SampleBuffer {
  /** Latencies in milliseconds, keyed by route class. */
  samples: Map<RouteClassId, number[]>;
  /** Total samples held — short-circuits the size check. */
  total: number;
  /** Whether the periodic flush timer is already armed. */
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** Reentrancy guard so concurrent observe() doesn't double-flush. */
  flushing: boolean;
}

const FLUSH_INTERVAL_MS = 60_000;
const FLUSH_BATCH_SIZE = 100;

/**
 * Singleton buffer. Stored on `globalThis` so HMR in dev doesn't shred the
 * timer between hot reloads (which would leave a stale interval running
 * against the previous module instance).
 */
const GLOBAL_KEY = Symbol.for("@poggle/perf-telemetry-buffer");

interface GlobalWithBuffer {
  [GLOBAL_KEY]?: SampleBuffer;
}

function getBuffer(): SampleBuffer {
  const g = globalThis as unknown as GlobalWithBuffer;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      samples: new Map(),
      total: 0,
      flushTimer: null,
      flushing: false,
    };
  }
  return g[GLOBAL_KEY];
}

/**
 * Resolve the active sampling rate. Decimal between 0 and 1.
 *
 *   - dev → 1.0
 *   - prod (default) → 0.01
 *   - prod with `PERF_TELEMETRY_SAMPLE_RATE` set → that, clamped to [0, 1]
 */
export function getSampleRate(): number {
  if (process.env.NODE_ENV !== "production") return 1.0;
  const raw = process.env.PERF_TELEMETRY_SAMPLE_RATE;
  if (!raw) return 0.01;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 0.01;
  return parsed;
}

/**
 * Record a single route-latency observation.
 *
 * Caller passes the request pathname; we map it to a route class via
 * `classifyRoute` so the rest of the pipeline never sees the raw URL.
 * No-op when sampled out.
 */
export function observeRouteLatency(pathname: string, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const rate = getSampleRate();
  if (rate <= 0) return;
  if (rate < 1 && Math.random() >= rate) return;

  const classId = classifyRoute(pathname);
  const buffer = getBuffer();

  const list = buffer.samples.get(classId) ?? [];
  list.push(durationMs);
  buffer.samples.set(classId, list);
  buffer.total += 1;

  if (buffer.total >= FLUSH_BATCH_SIZE) {
    // Don't await — fire-and-forget so we don't add latency to the
    // request that just finished.
    void flushBuffer().catch(() => {});
    return;
  }

  // Lazy-arm the periodic flush timer. We don't use `setInterval` because
  // we want exactly one flush per buffer fill cycle and a timer that
  // disarms after each successful flush.
  if (!buffer.flushTimer) {
    buffer.flushTimer = setTimeout(() => {
      void flushBuffer().catch(() => {});
    }, FLUSH_INTERVAL_MS);
    // `unref` so the timer doesn't keep the process alive past shutdown.
    // Edge runtime's setTimeout return value doesn't have unref; guard.
    const t = buffer.flushTimer as { unref?: () => void };
    if (typeof t.unref === "function") t.unref();
  }
}

/**
 * Flush the in-process buffer to Supabase. Visible for testing; callers
 * should normally rely on the automatic flush behaviour above.
 *
 * Returns the number of rows inserted (one per route class with samples).
 * Returns 0 if there's nothing to flush, the service-role key is missing,
 * or another flush is already in flight.
 */
export async function flushBuffer(): Promise<number> {
  const buffer = getBuffer();
  if (buffer.flushing) return 0;
  if (buffer.total === 0) return 0;
  // Skip in environments without a service-role key (e.g. preview branches
  // with a public-only Supabase config). The buffer keeps growing until
  // FLUSH_BATCH_SIZE; that's fine — it's bounded and process-lifetime.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return 0;

  buffer.flushing = true;

  // Snapshot + reset before the network call so concurrent observe()s
  // populate the next batch, not the one being flushed.
  const snapshot = buffer.samples;
  buffer.samples = new Map();
  buffer.total = 0;
  if (buffer.flushTimer) {
    clearTimeout(buffer.flushTimer);
    buffer.flushTimer = null;
  }

  try {
    const rows = Array.from(snapshot.entries())
      .filter(([, samples]) => samples.length > 0)
      .map(([routeClass, samples]) => {
        const sorted = [...samples].sort((a, b) => a - b);
        return {
          route_class: routeClass,
          p50_ms: percentile(sorted, 0.5),
          p95_ms: percentile(sorted, 0.95),
          p99_ms: percentile(sorted, 0.99),
          sample_count: sorted.length,
          source: "edge" as const,
        };
      });

    if (rows.length === 0) return 0;

    // Lazy-import the admin client so the edge bundle doesn't pull
    // node-only Supabase deps. This module is imported from `proxy.ts`
    // which runs in the edge runtime.
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const { error } = await admin.from("perf_route_observations").insert(rows);
    if (error) {
      // Don't crash the request path on a write failure — log and move on.
      // Sentry will surface persistent failures via the alert layer.
      // eslint-disable-next-line no-console
      console.warn("[perf] flush failed:", error.message);
      return 0;
    }
    return rows.length;
  } finally {
    buffer.flushing = false;
  }
}

/** Compute an inclusive percentile from an already-sorted array. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return Math.round(sortedAsc[0]!);
  const rank = (sortedAsc.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return Math.round(sortedAsc[lo]!);
  const frac = rank - lo;
  return Math.round(sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac);
}
