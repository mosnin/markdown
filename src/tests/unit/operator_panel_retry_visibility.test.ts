import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Contract test for the panel's "failed phase" retry button.
//
// The repo's vitest config runs in node (no jsdom) — we can't render the
// component, so we assert the *source-level* contract instead:
//
//   1. operator_panel.tsx defines a `renderFailed` function.
//   2. That function calls `handleRetry` (the real cancel/retry handler,
//      asserted elsewhere to call retryRunAction).
//   3. The same function renders a button whose visible text matches
//      /retry/i — guards against the regression where the failed view
//      shipped without a retry CTA at all.
// ---------------------------------------------------------------------------

const PANEL_PATH = resolve(
  __dirname,
  "../../components/product/operator/operator_panel.tsx"
);
const panelSource = readFileSync(PANEL_PATH, "utf8");

describe("operator_panel.tsx renderFailed", () => {
  it("declares a renderFailed function", () => {
    expect(panelSource).toMatch(/function\s+renderFailed\s*\(\s*\)\s*\{/);
  });

  it("uses renderFailed for the 'failed' phase in the body selector", () => {
    // Defensive: a renderFailed that's never called is just dead code.
    // The body selector is a switch-case mapping phase → render fn.
    expect(panelSource).toMatch(/case\s+"failed"\s*:\s*\n?\s*return\s+renderFailed\s*\(\s*\)/);
  });

  it("renderFailed wires its primary button to handleRetry", () => {
    const block = panelSource.match(
      /function\s+renderFailed\s*\(\s*\)\s*\{[\s\S]*?\n\s{2}\}/
    );
    expect(block).not.toBeNull();
    // The Retry button's onClick must invoke handleRetry — anything else
    // would be a UI lie like the pre-Wave-2 cancel button.
    expect(block![0]).toMatch(/onClick=\{\s*handleRetry\s*\}/);
  });

  it("renderFailed renders a button whose text matches /retry/i", () => {
    const block = panelSource.match(
      /function\s+renderFailed\s*\(\s*\)\s*\{[\s\S]*?\n\s{2}\}/
    );
    expect(block).not.toBeNull();
    // We're matching the JSX text node, not just any occurrence of the word
    // — a stray comment shouldn't satisfy the contract. The button is a
    // <Button>...</Button> JSX expression containing the word Retry.
    const hasRetryButton = /<Button\b[\s\S]*?>[\s\S]*?retry[\s\S]*?<\/Button>/i.test(
      block![0]
    );
    expect(hasRetryButton).toBe(true);
  });

  it("the retry button is gated on a runId being present (no orphan retry)", () => {
    // Retrying with no runId would just dispatch retryRunAction("") — the
    // action would reject with "runId is required.". The panel guards
    // visibility with `runId &&` so the button only appears once we have
    // an id to pass through.
    const block = panelSource.match(
      /function\s+renderFailed\s*\(\s*\)\s*\{[\s\S]*?\n\s{2}\}/
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(
      /\{\s*runId\s*&&[\s\S]*?<Button\b[\s\S]*?onClick=\{\s*handleRetry\s*\}/
    );
  });
});
