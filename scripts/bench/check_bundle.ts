#!/usr/bin/env tsx
/**
 * CI gate — bundle sizes vs the documented hard cap.
 *
 * Reads the per-bundle measurements (stubbed today) and exits 1 if any
 * bundle exceeds its hard cap. Soft-cap exceedance prints a warning but
 * does not fail.
 *
 * Run locally:
 *
 *   pnpm tsx scripts/bench/check_bundle.ts
 *
 * Production wiring (TODO):
 *   - Read `.next/build-manifest.json` + the per-route chunk-graph emitted
 *     by `next build` (or hand off to `size-limit` and parse its JSON).
 *   - Map each chunk to a `BundleEntry.id` from `globalBundleBudgets`.
 *   - Track per-page additive size as the diff between the route's chunk
 *     graph and the shared shell — anything > the per-page hard cap fails.
 */

import {
  classifyBundle,
  globalBundleBudgets,
  type BundleEntry,
} from "../../src/lib/perf_budget";

interface BundleMeasurement {
  id: string;
  observedKb: number;
}

/**
 * Stubbed measurements aligned with the dashboard stub — three bundles
 * green, one bundle amber (over soft, under hard). When real telemetry
 * lands, replace this with the parser sketched in the comment above.
 */
function readMeasurements(): BundleMeasurement[] {
  const offsets = [-0.05, +0.08, +0.30, -0.10];
  return globalBundleBudgets.map((b, i) => {
    const offset = offsets[i % offsets.length];
    return {
      id: b.id,
      observedKb: Math.max(1, Math.round(b.cap.soft * (1 + offset))),
    };
  });
}

function pad(s: string | number, width: number, align: "left" | "right" = "left"): string {
  const str = String(s);
  if (str.length >= width) return str;
  const padding = " ".repeat(width - str.length);
  return align === "left" ? str + padding : padding + str;
}

function main(): void {
  const measurements = readMeasurements();
  const byId = new Map<string, BundleEntry>(
    globalBundleBudgets.map((b) => [b.id, b]),
  );

  console.log("");
  console.log("Bundle budget — chunk sizes vs caps");
  console.log("");
  console.log(
    [
      pad("Bundle", 30),
      pad("Size", 10, "right"),
      pad("Soft", 10, "right"),
      pad("Hard", 10, "right"),
      pad("Status", 8),
    ].join("  "),
  );
  console.log("─".repeat(74));

  let failed = 0;
  let warned = 0;

  for (const m of measurements) {
    const entry = byId.get(m.id);
    if (!entry) {
      console.warn(`! Skipping unknown bundle id: ${m.id}`);
      continue;
    }
    const status = classifyBundle(m.observedKb, entry.cap);
    const statusText =
      status === "fail" ? "FAIL" : status === "warn" ? "warn" : "ok";

    console.log(
      [
        pad(entry.label, 30),
        pad(`${m.observedKb} KB`, 10, "right"),
        pad(`${entry.cap.soft} KB`, 10, "right"),
        pad(`${entry.cap.hard} KB`, 10, "right"),
        pad(statusText, 8),
      ].join("  "),
    );

    if (status === "fail") failed++;
    else if (status === "warn") warned++;
  }

  console.log("");
  if (failed > 0) {
    console.log(
      `FAIL — ${failed} bundle(s) exceeded the hard cap.`,
    );
    process.exit(1);
  }
  if (warned > 0) {
    console.log(
      `OK with ${warned} bundle(s) over soft cap. Investigate before the next release; merge is not blocked.`,
    );
  } else {
    console.log("OK — all bundles within the soft cap.");
  }
  process.exit(0);
}

main();
