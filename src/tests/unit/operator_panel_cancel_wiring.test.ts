import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Contract tests for the panel's cancel + retry wiring.
//
// The panel imports `cancelRunAction` and `retryRunAction` from
// `actions.ts` and calls them from the inline handlers `handleCancel` /
// `handleRetry`. We assert two things:
//
//   1. The actions module actually exports those functions (callable, async).
//   2. The panel source file imports the right names from the right module
//      — a static check that survives any future re-export shuffle.
// ---------------------------------------------------------------------------

// `actions.ts` is a "use server" module; mock its server-only collaborators
// so importing it from a node-environment test does not boot Supabase /
// Modal / auth context. We only need the action symbols to exist.
vi.mock("@/server/auth/get_request_context", () => ({
  getRequestContext: vi.fn(() =>
    Promise.resolve({
      isAuthenticated: false,
      user: null,
      workspace: null,
    })
  ),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve({})),
}));
vi.mock("@/server/services/workspace_operator_service", () => ({
  dispatchOperatorRun: vi.fn(),
  dispatchOperatorPlan: vi.fn(),
  dispatchOperatorExecute: vi.fn(),
  cancelOperatorRun: vi.fn(),
  retryOperatorRun: vi.fn(),
}));
vi.mock("@/server/services/workspace_operator_runs_service", () => ({
  createOperatorRun: vi.fn(),
  updateOperatorRun: vi.fn(),
}));
vi.mock("@/server/services/workspace_operator_usage_service", () => ({
  recordOperatorUsage: vi.fn(),
}));
vi.mock("@/server/services/workspace_operator_quota_service", () => ({
  checkOperatorQuota: vi.fn(),
}));
vi.mock("@/server/services/operator_prompts_service", () => ({
  listOperatorPrompts: vi.fn(),
  createOperatorPrompt: vi.fn(),
}));
vi.mock("@/server/services/operator_notifications_service", () => ({
  notifyRunCompleted: vi.fn(),
  notifyRunFailed: vi.fn(),
}));
vi.mock("@/server/services/branch_service", () => ({
  createDraftBranch: vi.fn(),
}));
vi.mock("@/server/repositories/audit_event_repository", () => ({
  createAuditEvent: vi.fn(),
}));

import * as actions from "@/app/app/workspace_operator/actions";

const PANEL_PATH = resolve(
  __dirname,
  "../../components/product/operator_panel.tsx"
);
const panelSource = readFileSync(PANEL_PATH, "utf8");

describe("actions.ts exports", () => {
  it("exports cancelRunAction as an async function", () => {
    expect(typeof actions.cancelRunAction).toBe("function");
    // Server actions are wrapped — but they always return a Promise.
    const result = actions.cancelRunAction("nonexistent");
    expect(result).toBeInstanceOf(Promise);
    // The inner ctx is unauthenticated in our mocks, so the action resolves
    // with `{ ok: false, error: "Unauthenticated." }` rather than throwing.
    return result.then((r) => {
      expect(r.ok).toBe(false);
    });
  });

  it("exports retryRunAction as an async function", () => {
    expect(typeof actions.retryRunAction).toBe("function");
    const result = actions.retryRunAction("nonexistent");
    expect(result).toBeInstanceOf(Promise);
    return result.then((r) => {
      expect(r.ok).toBe(false);
    });
  });

  it("cancelRunAction has the documented signature (runId: string) => Promise<...>", () => {
    // arity check — the function takes exactly one positional arg.
    expect(actions.cancelRunAction.length).toBe(1);
  });

  it("retryRunAction has the documented signature (runId: string) => Promise<...>", () => {
    expect(actions.retryRunAction.length).toBe(1);
  });
});

describe("operator_panel.tsx imports the cancel/retry actions from actions.ts", () => {
  it("imports cancelRunAction from @/app/app/workspace_operator/actions", () => {
    // Find the import block from the actions module and assert both names
    // are present. Tolerates whitespace / member ordering changes.
    const importBlock = panelSource.match(
      /import\s*\{[^}]*\}\s*from\s*"@\/app\/app\/workspace_operator\/actions"/
    );
    expect(importBlock).not.toBeNull();
    expect(importBlock![0]).toMatch(/\bcancelRunAction\b/);
  });

  it("imports retryRunAction from @/app/app/workspace_operator/actions", () => {
    const importBlock = panelSource.match(
      /import\s*\{[^}]*\}\s*from\s*"@\/app\/app\/workspace_operator\/actions"/
    );
    expect(importBlock).not.toBeNull();
    expect(importBlock![0]).toMatch(/\bretryRunAction\b/);
  });

  it("invokes cancelRunAction(runId) inside handleCancel", () => {
    // Loose proximity check — the handler must actually call the action,
    // not just import it. Guards the regression where Cancel was a UI lie.
    const handler = panelSource.match(
      /function\s+handleCancel\s*\([^)]*\)\s*\{[\s\S]*?\n\s{2}\}/
    );
    expect(handler).not.toBeNull();
    expect(handler![0]).toMatch(/cancelRunAction\s*\(\s*runId\s*\)/);
  });

  it("invokes retryRunAction(runId) inside handleRetry", () => {
    const handler = panelSource.match(
      /function\s+handleRetry\s*\([^)]*\)\s*\{[\s\S]*?\n\s{2}\}/
    );
    expect(handler).not.toBeNull();
    expect(handler![0]).toMatch(/retryRunAction\s*\(\s*runId\s*\)/);
  });
});
