import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Contract tests for `actionErrorToString`, the panel's `setError` adapter.
//
// `ActionResult.error` is `string | ActionErrorQuotaExceeded` — anywhere the
// panel calls setError(...) it threads the value through this helper so a
// structured quota-exceeded body doesn't render as "[object Object]".
//
// The helper is exported from operator_panel.tsx specifically so this test
// can import it without rendering the component (the file is "use client",
// but the helper itself is a pure function and JSX-free).
// ---------------------------------------------------------------------------

// `operator_panel.tsx` re-exports types from actions.ts; importing it from
// node-only vitest needs the same server-side mocks as the cancel-wiring
// test so the action module's "use server" graph stays inert.
vi.mock("@/server/auth/get_request_context", () => ({
  getRequestContext: vi.fn(() =>
    Promise.resolve({ isAuthenticated: false, user: null, workspace: null })
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
// quota_actions is imported by operator_panel.tsx and is also a "use server"
// module — stub it so the import graph stays node-safe.
vi.mock("@/app/app/workspace_operator/quota_actions", () => ({
  loadOperatorQuotaAction: vi.fn(),
}));
// React + lucide-react + UI primitives are pulled in by the panel's top-level
// imports. They're harmless under a node environment because we never render,
// but `useOperatorProgress` reaches for `EventSource` etc. — stub it too.
vi.mock("@/lib/hooks/use_operator_run", () => ({
  useOperatorProgress: vi.fn(() => ({ events: [], reset: vi.fn() })),
}));

import { actionErrorToString } from "@/components/product/operator/operator_panel";

describe("actionErrorToString", () => {
  it("returns the fallback when error is null", () => {
    expect(actionErrorToString(null, "fallback")).toBe("fallback");
  });

  it("returns the fallback when error is undefined", () => {
    expect(actionErrorToString(undefined, "fallback")).toBe("fallback");
  });

  it("passes a plain string error through verbatim", () => {
    expect(actionErrorToString("Boom", "fallback")).toBe("Boom");
    // Empty string is still a string — no fallback substitution. The
    // panel never produces empty-string errors, so this guards against
    // accidental "" → "fallback" coercion creeping in later.
    expect(actionErrorToString("", "fallback")).toBe("");
  });

  it("extracts .message from a quota_exceeded structured error", () => {
    const err = {
      code: "quota_exceeded" as const,
      message: "You've used all 10 Operator runs this month.",
      tier: "free" as const,
      limit: 10,
      used: 10,
      resetsAt: "2026-05-01T00:00:00Z",
    };
    expect(actionErrorToString(err, "fallback")).toBe(
      "You've used all 10 Operator runs this month."
    );
  });

  it("falls back when a structured error has an undefined message", () => {
    // Constructing a structurally-incomplete value (no message). The runtime
    // contract is "if .message is missing, surface the fallback so the user
    // still sees something useful". Cast to satisfy TS — at runtime the
    // panel sometimes receives wire-shape errors with absent fields.
    const err = {
      code: "quota_exceeded",
      message: undefined,
      tier: "free",
      limit: 10,
      used: 10,
      resetsAt: "2026-05-01T00:00:00Z",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    expect(actionErrorToString(err, "fallback")).toBe("fallback");
  });
});
