import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Contract tests for the Operator panel's model picker.
//
// The panel reads `OPERATOR_MODELS` to render its <select> options and uses
// `DEFAULT_OPERATOR_MODEL` as the initial selection. `OPERATOR_MODEL_RATES`
// powers the cost preview, so every model id in the picker MUST have a rate
// entry — a missing rate would silently fall through to the default and
// under-quote the user.
// ---------------------------------------------------------------------------

import {
  OPERATOR_MODELS,
  DEFAULT_OPERATOR_MODEL,
  OPERATOR_MODEL_RATES,
} from "@/app/app/workspace_operator/types";

describe("OPERATOR_MODELS", () => {
  it("contains the current model lineup", () => {
    expect(OPERATOR_MODELS).toEqual([
      "gpt-4.1-mini",
      "gpt-5.4-mini",
      "o4-mini",
      "gpt-4.1",
      "o3",
    ]);
  });

  it("has no duplicates", () => {
    expect(new Set(OPERATOR_MODELS).size).toBe(OPERATOR_MODELS.length);
  });
});

describe("DEFAULT_OPERATOR_MODEL", () => {
  it('is "gpt-5.4-mini" (best default for new runs)', () => {
    expect(DEFAULT_OPERATOR_MODEL).toBe("gpt-5.4-mini");
  });

  it("is itself a member of OPERATOR_MODELS", () => {
    expect((OPERATOR_MODELS as readonly string[]).includes(DEFAULT_OPERATOR_MODEL)).toBe(
      true
    );
  });
});

describe("OPERATOR_MODEL_RATES", () => {
  it("has an entry for every model exposed by the picker", () => {
    for (const m of OPERATOR_MODELS) {
      expect(OPERATOR_MODEL_RATES[m]).toBeDefined();
      expect(typeof OPERATOR_MODEL_RATES[m].inputUsdPerMillion).toBe("number");
      expect(typeof OPERATOR_MODEL_RATES[m].outputUsdPerMillion).toBe("number");
      expect(OPERATOR_MODEL_RATES[m].inputUsdPerMillion).toBeGreaterThan(0);
      expect(OPERATOR_MODEL_RATES[m].outputUsdPerMillion).toBeGreaterThan(0);
    }
  });

  it("does not advertise a rate for a model the picker cannot reach", () => {
    // Defensive: the picker is the only legitimate source of model ids in
    // the UI. Extra rate entries would imply drift from the Python-side
    // ALLOWED_OPERATOR_MODELS / billing service.
    const rateKeys = Object.keys(OPERATOR_MODEL_RATES).sort();
    const pickerKeys = [...OPERATOR_MODELS].sort();
    expect(rateKeys).toEqual(pickerKeys);
  });

  it("prices output above input for every model (gpt convention)", () => {
    for (const m of OPERATOR_MODELS) {
      expect(OPERATOR_MODEL_RATES[m].outputUsdPerMillion).toBeGreaterThan(
        OPERATOR_MODEL_RATES[m].inputUsdPerMillion
      );
    }
  });
});
