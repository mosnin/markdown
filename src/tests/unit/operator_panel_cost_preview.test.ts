import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Contract tests for the Operator panel's "Estimated max cost" preview.
//
// The math lives in `types.ts` so the panel (a "use client" component) can
// call it without dragging "use server" code across the client boundary.
// We exercise the pure helpers directly per the repo's no-jsdom convention:
//
//   - estimateOperatorRunCost: dollar amount given (promptLength, stepCount,
//     model). Worst-case upper bound — actual is almost always lower.
//   - formatOperatorCostUsd: terse $X.XX / <$0.01 / $0.000 / $0.00 formatter.
// ---------------------------------------------------------------------------

import {
  estimateOperatorRunCost,
  formatOperatorCostUsd,
  OPERATOR_MODEL_RATES,
  COST_PREVIEW_OUTPUT_TOKENS_PER_STEP,
  COST_PREVIEW_CONTEXT_OVERHEAD_TOKENS,
  DEFAULT_OPERATOR_MODEL,
} from "@/app/app/workspace_operator/types";

// ─── estimateOperatorRunCost ────────────────────────────────────────────────

describe("estimateOperatorRunCost", () => {
  it("returns 0 for an empty plan (no steps)", () => {
    expect(estimateOperatorRunCost(0, 0, "gpt-4.1-mini")).toBe(0);
    expect(estimateOperatorRunCost(100, 0, "gpt-4.1-mini")).toBe(0);
    expect(estimateOperatorRunCost(100, 0, "gpt-4.1")).toBe(0);
  });

  it("returns 0 for negative or fractional step counts (clamped to 0)", () => {
    expect(estimateOperatorRunCost(100, -3, "gpt-4.1-mini")).toBe(0);
    expect(estimateOperatorRunCost(100, 0.4, "gpt-4.1-mini")).toBe(0);
  });

  it("computes the documented value for 1-step gpt-4.1-mini, 100-char prompt", () => {
    // Manual derivation:
    //   inputTokensPerStep = ceil(100/4) + 2000 = 25 + 2000 = 2025
    //   totalInputTokens   = 2025 * 1 = 2025
    //   totalOutputTokens  = 500 * 1 = 500
    //   inputUsd  = 2025 / 1e6 * 0.4  = 0.00081
    //   outputUsd =  500 / 1e6 * 1.6  = 0.0008
    //   total     = 0.00161
    const got = estimateOperatorRunCost(100, 1, "gpt-4.1-mini");
    expect(got).toBeCloseTo(0.00161, 8);
  });

  it("scales ~5x when switching gpt-4.1-mini → gpt-4.1 (same plan)", () => {
    const mini = estimateOperatorRunCost(100, 1, "gpt-4.1-mini");
    const big = estimateOperatorRunCost(100, 1, "gpt-4.1");
    // gpt-4.1 rates are exactly 5x gpt-4.1-mini on both input and output
    // (0.4→2, 1.6→8), so the total is exactly 5x as well.
    expect(big / mini).toBeCloseTo(5, 6);
    expect(big).toBeCloseTo(0.00805, 8);
  });

  it("falls back to the default model rate for an unknown model id", () => {
    const known = estimateOperatorRunCost(100, 2, DEFAULT_OPERATOR_MODEL);
    const unknown = estimateOperatorRunCost(100, 2, "definitely-not-a-model");
    expect(unknown).toBeCloseTo(known, 10);
  });

  it("falls back to the default model rate for null / undefined model", () => {
    const known = estimateOperatorRunCost(100, 2, DEFAULT_OPERATOR_MODEL);
    expect(estimateOperatorRunCost(100, 2, null)).toBeCloseTo(known, 10);
    expect(estimateOperatorRunCost(100, 2, undefined)).toBeCloseTo(known, 10);
  });

  it("scales linearly with step count on a fixed prompt+model", () => {
    const one = estimateOperatorRunCost(400, 1, "gpt-4.1-mini");
    const five = estimateOperatorRunCost(400, 5, "gpt-4.1-mini");
    expect(five / one).toBeCloseTo(5, 6);
  });

  it("uses the documented overhead constants", () => {
    // Indirect proof: a 0-char prompt should cost exactly the overhead +
    // output portion. For gpt-4.1-mini, 1 step:
    //   inputUsd  = 2000 / 1e6 * 0.4 = 0.0008
    //   outputUsd =  500 / 1e6 * 1.6 = 0.0008
    //   total = 0.0016
    const overheadOnly = estimateOperatorRunCost(0, 1, "gpt-4.1-mini");
    const expectedInput =
      (COST_PREVIEW_CONTEXT_OVERHEAD_TOKENS / 1_000_000) *
      OPERATOR_MODEL_RATES["gpt-4.1-mini"].inputUsdPerMillion;
    const expectedOutput =
      (COST_PREVIEW_OUTPUT_TOKENS_PER_STEP / 1_000_000) *
      OPERATOR_MODEL_RATES["gpt-4.1-mini"].outputUsdPerMillion;
    expect(overheadOnly).toBeCloseTo(expectedInput + expectedOutput, 10);
  });
});

// ─── formatOperatorCostUsd ──────────────────────────────────────────────────

describe("formatOperatorCostUsd", () => {
  it("renders $0.00 for zero / negative / non-finite", () => {
    expect(formatOperatorCostUsd(0)).toBe("$0.00");
    expect(formatOperatorCostUsd(-1)).toBe("$0.00");
    expect(formatOperatorCostUsd(NaN)).toBe("$0.00");
    expect(formatOperatorCostUsd(Infinity)).toBe("$0.00");
  });

  it("renders <$0.01 for sub-cent positive values", () => {
    expect(formatOperatorCostUsd(0.001)).toBe("<$0.01");
    expect(formatOperatorCostUsd(0.0099)).toBe("<$0.01");
    // The realistic 1-step gpt-4.1-mini estimate ($0.00161) lands here.
    expect(formatOperatorCostUsd(0.00161)).toBe("<$0.01");
  });

  it("renders 3-decimal $0.XYZ between 1 cent and $1", () => {
    expect(formatOperatorCostUsd(0.123)).toBe("$0.123");
    expect(formatOperatorCostUsd(0.01)).toBe("$0.010");
    expect(formatOperatorCostUsd(0.999)).toBe("$0.999");
  });

  it("renders 2-decimal $X.YZ for values >= $1", () => {
    expect(formatOperatorCostUsd(1.23)).toBe("$1.23");
    expect(formatOperatorCostUsd(1)).toBe("$1.00");
    expect(formatOperatorCostUsd(42.5)).toBe("$42.50");
    expect(formatOperatorCostUsd(1234.567)).toBe("$1234.57");
  });
});
