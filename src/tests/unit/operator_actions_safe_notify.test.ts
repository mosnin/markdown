/**
 * `safeNotify` wiring + contract tests.
 *
 * Two layers of coverage:
 *
 *   1. Source-string assertions (no module load) — confirm the action file
 *      imports `notifyRunCompleted` / `notifyRunFailed`, declares a
 *      `safeNotify` helper, and calls it on success AND failure paths in
 *      both the full-mode and execute-mode dispatchers (4 calls total).
 *      Vitest can't easily execute a `"use server"` module, but it can
 *      grep its bytes — which is the right level for "is the wiring in
 *      place" coverage.
 *
 *   2. Helper contract — import `safeNotify` (it's exported from the
 *      source for testability; exporting an internal best-effort helper
 *      from a server-action file is a deliberate trade-off documented in
 *      the action's source) and assert that a thrown notification error
 *      is swallowed, NOT propagated. This is the load-bearing invariant
 *      the helper exists to provide.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Mocks for the helper-contract test. Declared up-front so the import of
// `actions.ts` below resolves to the mocked module.
// ---------------------------------------------------------------------------

const notifyRunCompletedMock = vi.fn();
const notifyRunFailedMock = vi.fn();

vi.mock("@/server/services/operator_notifications_service", () => ({
  notifyRunCompleted: (...args: unknown[]) => notifyRunCompletedMock(...args),
  notifyRunFailed: (...args: unknown[]) => notifyRunFailedMock(...args),
}));

// The actions file pulls in a number of other server services at import
// time. They aren't exercised by `safeNotify` itself, but the module-level
// imports must resolve, so we provide minimal stubs.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/server/auth/get_request_context", () => ({
  getRequestContext: vi.fn(),
}));
vi.mock("@/server/services/branch_service", () => ({
  createDraftBranch: vi.fn(),
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
vi.mock("@/lib/env", () => ({
  isWorkspaceOperatorEnabled: vi.fn(() => true),
}));
vi.mock("@/server/repositories/audit_event_repository", () => ({
  createAuditEvent: vi.fn(),
}));

const ACTIONS_PATH = resolve(
  __dirname,
  "../../app/app/workspace_operator/actions.ts"
);

async function readActionsSource(): Promise<string> {
  return readFile(ACTIONS_PATH, "utf8");
}

// ---------------------------------------------------------------------------
// Layer 1 — source-string wiring assertions
// ---------------------------------------------------------------------------

describe("workspace_operator/actions.ts — safeNotify wiring", () => {
  let source = "";

  beforeEach(async () => {
    source = await readActionsSource();
  });

  it("imports notifyRunCompleted and notifyRunFailed from operator_notifications_service", () => {
    // Match a single import block that pulls both names from the
    // notifications service. We allow whitespace flexibility but pin
    // the source path so a typo'd alias is caught.
    expect(source).toMatch(/notifyRunCompleted/);
    expect(source).toMatch(/notifyRunFailed/);
    expect(source).toMatch(
      /from\s+"@\/server\/services\/operator_notifications_service"/
    );
  });

  it("declares a safeNotify helper", () => {
    // Helper signature: an async function named safeNotify. We don't
    // pin the parameter list verbatim so the helper can grow optional
    // args without breaking this test.
    expect(source).toMatch(/(async\s+function|export\s+async\s+function)\s+safeNotify\s*\(/);
  });

  it("invokes safeNotify exactly four times — success+failure for full-mode and execute-mode", () => {
    // Count call sites only — the helper *declaration* uses
    // `function safeNotify(` (no leading `await`), so it won't match
    // `safeNotify(` when prefixed with `await `.
    const callMatches = source.match(/await\s+safeNotify\s*\(/g) ?? [];
    expect(callMatches.length).toBe(4);
  });

  it("each safeNotify call passes a runId arg and a 'completed' | 'failed' outcome", () => {
    // Pull every call site (across multiple lines) and check each one
    // against an allow-list of acceptable shapes:
    //   safeNotify(supabase, runId, "completed")
    //   safeNotify(supabase, runId, "failed")
    //   safeNotify(supabase, input.runId, "failed")
    //   safeNotify(supabase, runId, result.status === "completed" ? "completed" : "failed")
    const callBlockRe = /await\s+safeNotify\s*\(([\s\S]*?)\)\s*;/g;
    const blocks = Array.from(source.matchAll(callBlockRe)).map((m) => m[1]);
    expect(blocks.length).toBe(4);
    for (const args of blocks) {
      // runId or input.runId must appear
      const hasRunId = /\b(runId|input\.runId)\b/.test(args);
      expect(hasRunId, `runId arg missing in: ${args}`).toBe(true);
      // outcome literal "completed" or "failed" appears (either as a
      // bare literal arg or inside a ternary that resolves to one).
      const hasOutcomeLiteral = /"completed"|"failed"/.test(args);
      expect(
        hasOutcomeLiteral,
        `outcome literal missing in: ${args}`
      ).toBe(true);
    }
  });

  it("safeNotify is invoked on the failure paths (catch blocks) for both modes", () => {
    // Defensive: confirm the helper is wired into the catch-blocks
    // (so a dispatch throw still emails the user). We look for the
    // helper appearing within a few lines of `safeUpdateRun(... "failed"`.
    const failureWindows = source.match(
      /safeUpdateRun\([^)]*"failed"[^;]*;[\s\S]{0,400}?await\s+safeNotify\s*\(/g
    );
    expect(failureWindows && failureWindows.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — safeNotify contract: thrown notification errors are swallowed.
// ---------------------------------------------------------------------------

describe("safeNotify — best-effort contract", () => {
  beforeEach(() => {
    notifyRunCompletedMock.mockReset();
    notifyRunFailedMock.mockReset();
  });

  it("dispatches to notifyRunCompleted for outcome='completed'", async () => {
    notifyRunCompletedMock.mockResolvedValue({ sent: false, reason: "no_api_key" });
    const { safeNotify } = await import("@/app/app/workspace_operator/actions");
    await safeNotify({} as never, "run-1", "completed");
    expect(notifyRunCompletedMock).toHaveBeenCalledTimes(1);
    expect(notifyRunCompletedMock).toHaveBeenCalledWith(
      expect.anything(),
      "run-1"
    );
    expect(notifyRunFailedMock).not.toHaveBeenCalled();
  });

  it("dispatches to notifyRunFailed for outcome='failed'", async () => {
    notifyRunFailedMock.mockResolvedValue({ sent: false, reason: "no_api_key" });
    const { safeNotify } = await import("@/app/app/workspace_operator/actions");
    await safeNotify({} as never, "run-2", "failed");
    expect(notifyRunFailedMock).toHaveBeenCalledTimes(1);
    expect(notifyRunFailedMock).toHaveBeenCalledWith(
      expect.anything(),
      "run-2"
    );
    expect(notifyRunCompletedMock).not.toHaveBeenCalled();
  });

  it("does NOT propagate a thrown notification error (best-effort)", async () => {
    notifyRunCompletedMock.mockRejectedValue(new Error("resend down"));
    const { safeNotify } = await import("@/app/app/workspace_operator/actions");
    // The whole point: if notifications crash, the action's primary
    // result must still be returned to the user. safeNotify swallows.
    await expect(
      safeNotify({} as never, "run-3", "completed")
    ).resolves.toBeUndefined();
  });

  it("does NOT propagate a thrown notification error on the failed path either", async () => {
    notifyRunFailedMock.mockRejectedValue(new Error("network blip"));
    const { safeNotify } = await import("@/app/app/workspace_operator/actions");
    await expect(
      safeNotify({} as never, "run-4", "failed")
    ).resolves.toBeUndefined();
  });
});
