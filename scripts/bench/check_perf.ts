#!/usr/bin/env tsx
/**
 * CI gate — route-class p95 latency vs the documented budget.
 *
 * Reads measurements (stubbed today) and exits 1 if any route class p95
 * exceeds budget by more than 20%. Prints a clear table either way so
 * a CI log search for "FAIL" or "OK" finds the right line fast.
 *
 * Run locally:
 *
 *   pnpm tsx scripts/bench/check_perf.ts
 *
 * Production wiring (TODO):
 *   - Read measurements from the synthetic-bench JSON snapshot
 *     (`./bench-output/<git-sha>.json`) produced by `pnpm bench:routes`.
 *   - Optionally cross-check against the rolling Sentry p95 query so a
 *     PR that improves synthetic but regresses prod still gets noticed.
 */

import {
  REGRESSION_THRESHOLD,
  classifyLatency,
  routeClassList,
  type RouteClassId,
} from "../../src/lib/perf_budget";

interface PerfMeasurement {
  classId: RouteClassId;
  observedP95Ms: number;
}

/**
 * Stubbed measurements — same offsets as the dashboard so the page and
 * the CI gate tell the same story today. Class E is +16% (amber, but
 * green-lit by the gate). When real telemetry lands, replace the body
 * of this function with a JSON read.
 */
function readMeasurements(): PerfMeasurement[] {
  const offsetByClass: Record<RouteClassId, number> = {
    A: -0.10,
    B: -0.05,
    C: +0.04,
    D: -0.08,
    E: +0.16,
    F: -0.12,
    G: -0.03,
    H: +0.06,
  };
  return routeClassList.map((cls) => ({
    classId: cls.id,
    observedP95Ms: Math.round(cls.latency.p95 * (1 + offsetByClass[cls.id])),
  }));
}

function pad(s: string | number, width: number, align: "left" | "right" = "left"): string {
  const str = String(s);
  if (str.length >= width) return str;
  const padding = " ".repeat(width - str.length);
  return align === "left" ? str + padding : padding + str;
}

function main(): void {
  const measurements = readMeasurements();

  console.log("");
  console.log("Performance budget — route-class p95");
  console.log(`Regression threshold: ${REGRESSION_THRESHOLD.toFixed(2)}× budget`);
  console.log("");
  console.log(
    [
      pad("Class", 6),
      pad("Label", 22),
      pad("Observed", 12, "right"),
      pad("Budget", 10, "right"),
      pad("Ratio", 8, "right"),
      pad("Status", 8),
    ].join("  "),
  );
  console.log("─".repeat(74));

  let failed = 0;
  let warned = 0;

  for (const m of measurements) {
    const cls = routeClassList.find((c) => c.id === m.classId);
    if (!cls) {
      console.warn(`! Skipping unknown route class id: ${m.classId}`);
      continue;
    }
    const status = classifyLatency(m.observedP95Ms, cls.latency.p95);
    const ratio = m.observedP95Ms / cls.latency.p95;

    const statusText =
      status === "fail" ? "FAIL" : status === "warn" ? "warn" : "ok";

    console.log(
      [
        pad(cls.id, 6),
        pad(cls.label, 22),
        pad(`${m.observedP95Ms} ms`, 12, "right"),
        pad(`${cls.latency.p95} ms`, 10, "right"),
        pad(`${ratio.toFixed(2)}×`, 8, "right"),
        pad(statusText, 8),
      ].join("  "),
    );

    if (status === "fail") failed++;
    else if (status === "warn") warned++;
  }

  console.log("");
  if (failed > 0) {
    console.log(
      `FAIL — ${failed} route class(es) exceeded budget by more than ${Math.round((REGRESSION_THRESHOLD - 1) * 100)}%.`,
    );
    process.exit(1);
  }
  if (warned > 0) {
    console.log(
      `OK with ${warned} amber class(es) — over budget but within the +${Math.round((REGRESSION_THRESHOLD - 1) * 100)}% regression line.`,
    );
  } else {
    console.log("OK — all route classes within budget.");
  }
  process.exit(0);
}

main();
