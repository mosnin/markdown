import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Contract tests for Workspace Operator gap #4 — live progress streaming.
//
// The vitest config runs in node (no jsdom), so we assert the source-level
// wiring rather than rendering. Three load-bearing invariants:
//
//   1. The panel still imports `useOperatorProgress` from the existing
//      realtime hook — we are not regressing back to a polling-only
//      implementation.
//   2. The subscription is live for EVERY non-terminal phase the spec
//      calls out (planning / awaiting_approval / executing), not just
//      "executing". Before this work it was gated on executing only, so
//      step_start / step_complete events arriving between approve+dispatch
//      went unobserved.
//   3. Awaiting-approval phase renders a small live log of recent events
//      (the spec's "latest N progress events with timestamp + message").
//   4. Progress teardown: the panel clears `runId` on close so the hook
//      (which removes the Supabase channel when runId goes null) lets
//      the subscription go when the sheet closes on a terminal phase.
//
// Channel naming (`operator_run:${runId}`) is owned by the hook and the
// `/api/agent/tools/progress` route; asserting it here would duplicate
// `operator_progress_route.test.ts`. We only assert the panel's wiring.
// ---------------------------------------------------------------------------

const PANEL_PATH = resolve(
  __dirname,
  "../../components/product/operator/operator_panel.tsx"
);
const HOOK_PATH = resolve(
  __dirname,
  "../../lib/hooks/use_operator_run.ts"
);
const PROGRESS_ROUTE_PATH = resolve(
  __dirname,
  "../../app/api/agent/tools/progress/route.ts"
);

const panelSource = readFileSync(PANEL_PATH, "utf8");
const hookSource = readFileSync(HOOK_PATH, "utf8");
const progressRouteSource = readFileSync(PROGRESS_ROUTE_PATH, "utf8");

describe("operator_panel.tsx — realtime progress subscription", () => {
  it("imports useOperatorProgress from the realtime hook (no polling fallback)", () => {
    expect(panelSource).toMatch(
      /import\s*\{\s*useOperatorProgress\s*\}\s*from\s*"@\/lib\/hooks\/use_operator_run"/
    );
  });

  it("subscribes during planning, awaiting_approval, and executing phases", () => {
    // Guard the regression where only "executing" was passed. The fix
    // derives an `isActivePhase` boolean that covers all non-terminal
    // phases the spec calls out.
    expect(panelSource).toMatch(/phase\s*===\s*"planning"/);
    expect(panelSource).toMatch(/phase\s*===\s*"awaiting_approval"/);
    expect(panelSource).toMatch(/phase\s*===\s*"executing"/);
  });

  it("passes runId into useOperatorProgress only when a non-terminal phase is active", () => {
    // The call site should look like `useOperatorProgress(isActivePhase ? runId : null)`
    // — i.e. gated on the active-phase predicate, not just a raw `runId`.
    // This ensures terminal phases (completed/failed/cancelled/quota_exceeded)
    // don't keep the channel open forever.
    expect(panelSource).toMatch(
      /useOperatorProgress\s*\(\s*(?:isActivePhase\s*\?\s*runId\s*:\s*null|isActivePhase\s*&&\s*runId)/
    );
  });

  it("renders a small live event log in the awaiting_approval view", () => {
    const block = panelSource.match(
      /function\s+renderAwaitingApproval\s*\(\s*\)\s*\{[\s\S]*?\n\s{2}\}/
    );
    expect(block).not.toBeNull();
    // The log iterates a tail of events and renders timestamp + formatted
    // detail. Matching on formatEventDetail is the tightest anchor since
    // it's the existing helper the executing view already uses.
    expect(block![0]).toMatch(/formatEventDetail/);
    expect(block![0]).toMatch(/toLocaleTimeString/);
  });

  it("clears runId on panel close for terminal phases (teardown)", () => {
    // With the Supabase channel keyed off runId in the hook, setting
    // runId=null is the teardown signal — the hook's cleanup calls
    // removeChannel. Asserting the effect exists.
    expect(panelSource).toMatch(/setRunId\s*\(\s*null\s*\)/);
    // The teardown branch must fire when the panel closes on a terminal
    // phase — tie those together via a proximity match.
    expect(panelSource).toMatch(
      /if\s*\(\s*open\s*\)\s*return;[\s\S]{0,400}?setRunId\s*\(\s*null\s*\)/
    );
  });
});

describe("realtime channel convention — panel hook aligns with progress route", () => {
  it("hook subscribes to `operator_run:${runId}` broadcast channel", () => {
    expect(hookSource).toMatch(/supabase\.channel\(\s*`operator_run:\$\{runId\}`\s*\)/);
    expect(hookSource).toMatch(/broadcast/);
    expect(hookSource).toMatch(/event:\s*"progress"/);
  });

  it("progress route broadcasts on the same channel name", () => {
    // The Modal agent POSTs to /api/agent/tools/progress; that route
    // sends a broadcast to `operator_run:<run_id>` which the hook
    // subscribes to. If either side drifts, live events silently stop.
    // The route derives the channel from the *authenticated* run id
    // (auth.ctx.runId), not the request body, as a defense-in-depth measure.
    expect(progressRouteSource).toMatch(/operator_run:\$\{auth\.ctx\.runId\}/);
    expect(progressRouteSource).toMatch(/event:\s*"progress"/);
  });
});
