/**
 * Performance budgets — single source of truth in code.
 *
 * Mirrors the route-class table in `docs/performance_budget_v1.md`. Both the
 * admin live-performance dashboard (`/app/admin/performance`) and the CI
 * gates under `scripts/bench/` import from this module so the doc, the
 * runtime UI, and the merge-blocking checks never drift.
 *
 * Adding a new route class:
 *   1. Edit the doc first (route-class budgets section).
 *   2. Mirror the numbers here under `routeClassBudgets`.
 *   3. Bump the doc cross-reference comment at the top of the corresponding
 *      table cell.
 *
 * Tightening an existing budget:
 *   1. Get two consecutive cycles of green data.
 *   2. Lower the number here AND in the doc at the same time.
 *   3. Note the change in the PR description so the budget history is
 *      reviewable.
 *
 * NEVER hardcode budget numbers in dashboard code — always import from this
 * file. NEVER edit the doc without editing this module (or vice versa).
 */

/** Latency budget for a single percentile, in milliseconds. */
export interface LatencyBudgetMs {
  /** Median (50th percentile). */
  p50: number;
  /** 95th percentile — the merge gate. */
  p95: number;
  /** 99th percentile — the hotfix line. */
  p99: number;
}

/** Bundle-size budget for the per-route additive payload, in kilobytes. */
export interface BundleBudgetKb {
  /** Soft cap — warn but do not block. */
  soft: number;
  /** Hard cap — CI fails. */
  hard: number;
}

/** A route class budget with its primary latency target. */
export interface RouteClassBudget {
  /** Single-letter class identifier (A–H). */
  id: RouteClassId;
  /** Short human label used in the dashboard table. */
  label: string;
  /** One-line description of what kinds of routes belong here. */
  description: string;
  /**
   * Primary latency metric for the dashboard. For server-rendered classes
   * (A–E) this is TTFB. For mutation actions (F) it is action latency.
   * For API/MCP (G) it is the read endpoint. For workers (H) it is the
   * job duration.
   */
  primaryMetric: string;
  /** Latency budget for the primary metric. */
  latency: LatencyBudgetMs;
  /** Optional per-route bundle budget. Only set for client-bearing classes. */
  bundle?: BundleBudgetKb;
}

export type RouteClassId =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H";

/**
 * Route-class budgets. Numbers track the canonical doc table. Bundle caps
 * mirror the "Bundle-size budgets" section: marketing (A) and per-page
 * additive caps come from there; auth (B) and shell (C) inherit the
 * route-class p99 numbers from the doc.
 */
export const routeClassBudgets: Record<RouteClassId, RouteClassBudget> = {
  A: {
    id: "A",
    label: "Marketing",
    description: "Static / ISR pages — `(marketing)/*`.",
    primaryMetric: "TTFB",
    latency: { p50: 50, p95: 120, p99: 250 },
    bundle: { soft: 90, hard: 140 },
  },
  B: {
    id: "B",
    label: "Auth surfaces",
    description: "Sign-in, reset, OAuth, capture, share, welcome, invite.",
    primaryMetric: "TTFB",
    latency: { p50: 120, p95: 300, p99: 600 },
    bundle: { soft: 110, hard: 170 },
  },
  C: {
    id: "C",
    label: "App shell",
    description: "Authenticated layout: topbar + sidebar + bootstrap fetches.",
    primaryMetric: "TTFB",
    latency: { p50: 200, p95: 500, p99: 1000 },
    bundle: { soft: 180, hard: 260 },
  },
  D: {
    id: "D",
    label: "List pages",
    description: "Skills, agents, workflows, branches, proposals, audit, activity, insights.",
    primaryMetric: "TTFB",
    latency: { p50: 250, p95: 600, p99: 1200 },
    bundle: { soft: 40, hard: 70 },
  },
  E: {
    id: "E",
    label: "Detail pages",
    description: "Note editor, file viewer, agent / box / skill / folder / run detail.",
    primaryMetric: "TTFB",
    latency: { p50: 300, p95: 800, p99: 1600 },
    bundle: { soft: 40, hard: 70 },
  },
  F: {
    id: "F",
    label: "Mutation actions",
    description: "Server actions: writes, deletes, lifecycle changes.",
    primaryMetric: "Action latency",
    latency: { p50: 200, p95: 600, p99: 1500 },
  },
  G: {
    id: "G",
    label: "API / MCP",
    description: "REST v1 read endpoints and MCP tool calls.",
    primaryMetric: "Read endpoint",
    latency: { p50: 80, p95: 200, p99: 500 },
  },
  H: {
    id: "H",
    label: "Background workers",
    description: "Embedding, diff, webhook, retention, KG extraction.",
    primaryMetric: "Job duration",
    latency: { p50: 800, p95: 2000, p99: 5000 },
  },
};

/** Convenience array — keeps insertion order A → H. */
export const routeClassList: RouteClassBudget[] = (
  ["A", "B", "C", "D", "E", "F", "G", "H"] as const
).map((id) => routeClassBudgets[id]);

/**
 * Background-worker SLAs — restated from the doc's Class H table so the
 * SLA card can render named jobs even though they roll up into one
 * route-class entry above.
 */
export interface WorkerSla {
  id: string;
  label: string;
  /** p95 budget in milliseconds. */
  p95Ms: number;
  /** Eventual-consistency window or retry policy, plain English. */
  sla: string;
}

export const workerSlas: WorkerSla[] = [
  {
    id: "embedding",
    label: "Embedding worker",
    p95Ms: 2_000,
    sla: "Eventually consistent within 60 s of save",
  },
  {
    id: "diff",
    label: "Diff worker",
    p95Ms: 800,
    sla: "Eventually consistent within 30 s",
  },
  {
    id: "webhook",
    label: "Webhook delivery",
    p95Ms: 3_000,
    sla: "Up to 5 retries with exponential backoff",
  },
  {
    id: "retention",
    label: "Branch retention sweep",
    p95Ms: 30_000,
    sla: "Daily, off-peak",
  },
  {
    id: "kg",
    label: "KG entity extraction",
    p95Ms: 5_000,
    sla: "Eventually consistent within 300 s",
  },
];

/**
 * Bundle budgets — global chunks (not per-route additive). These cover
 * the marketing shared chunk, the app shell chunk, and the total CSS
 * after Tailwind purge.
 */
export interface BundleEntry {
  id: string;
  label: string;
  cap: BundleBudgetKb;
}

export const globalBundleBudgets: BundleEntry[] = [
  {
    id: "marketing-shared",
    label: "(marketing) shared chunk",
    cap: { soft: 90, hard: 140 },
  },
  {
    id: "app-shell",
    label: "/app shell chunk",
    cap: { soft: 180, hard: 260 },
  },
  {
    id: "per-page-additive",
    label: "Per-page additive",
    cap: { soft: 40, hard: 70 },
  },
  {
    id: "total-css",
    label: "Total CSS (post-purge)",
    cap: { soft: 35, hard: 55 },
  },
];

/**
 * Threshold (multiplier) above which a p95 measurement is considered a
 * regression that should fail CI. Mirrors the doc: "a single PR's
 * synthetic benchmark exceeds the route-class budget by >20%."
 */
export const REGRESSION_THRESHOLD = 1.2;

/** Status returned by `classifyLatency`. Drives green/amber/red in the UI. */
export type BudgetStatus = "ok" | "warn" | "fail";

/**
 * Classify an observed p95 against a budget:
 *   - `ok` if at or below the budget
 *   - `warn` if above budget but within `REGRESSION_THRESHOLD` (≤20% over)
 *   - `fail` if above `REGRESSION_THRESHOLD * budget` (the CI-blocking line)
 */
export function classifyLatency(
  observedMs: number,
  budgetMs: number,
): BudgetStatus {
  if (observedMs <= budgetMs) return "ok";
  if (observedMs <= budgetMs * REGRESSION_THRESHOLD) return "warn";
  return "fail";
}

/** Same shape as `classifyLatency` but for bundle KB against soft/hard caps. */
export function classifyBundle(
  observedKb: number,
  cap: BundleBudgetKb,
): BudgetStatus {
  if (observedKb <= cap.soft) return "ok";
  if (observedKb <= cap.hard) return "warn";
  return "fail";
}

/**
 * Classify a request pathname into a route class (A–H).
 *
 * This is the ONE place that knows the route → class mapping, so the
 * dashboard, the CI gate, the instrumentation hook and the alert service
 * never disagree.
 *
 * Intentionally PII-free: only the pathname is inspected, never query
 * params or user ids. Unknown paths default to 'C' (app shell) so they
 * still count toward a budget — silently dropping samples is worse than
 * miscounting one class.
 */
export function classifyRoute(pathname: string): RouteClassId {
  // Strip query / fragment if a caller forgot to.
  const path = pathname.split(/[?#]/, 1)[0] ?? pathname;

  // API / MCP — must come before /app/** so /api/v1/notes doesn't fall
  // into one of the app classes.
  if (path.startsWith("/api/v1") || path.startsWith("/api/mcp")) return "G";

  // Auth surfaces — sign-in, OAuth, password reset, capture intake,
  // share landing, welcome, invite acceptance.
  if (
    /^\/(sign_in|reset-password|oauth|capture|share|welcome|invite|u\b)/.test(
      path,
    )
  ) {
    return "B";
  }

  // App detail pages — segments that include an entity id after the type.
  // We treat anything with an extra path segment after `/app/<type>/`
  // as a detail page. Order matters: detail before list.
  if (
    /^\/app\/(notes|files|agents|boxes|skills|folders|runs|workflows|branches|proposals)\/[^/]+/.test(
      path,
    )
  ) {
    return "E";
  }

  // App list pages — /app/<type> with no further segment.
  if (
    /^\/app\/(skills|agents|workflows|branches|proposals|audit|activity|insights|notes|files|boxes|folders|runs)$/.test(
      path,
    )
  ) {
    return "D";
  }

  // App shell — /app and /app/admin/*.
  if (path === "/app" || path.startsWith("/app")) return "C";

  // Marketing — everything else (root, /pricing, /docs, marketing pages).
  return "A";
}
