import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock dependencies before imports
// ---------------------------------------------------------------------------

vi.mock("@/lib/env", () => ({
  isWorkspaceOperatorEnabled: vi.fn(() => true),
}));

vi.mock("@/server/auth/get_request_context", () => ({
  getRequestContext: vi.fn(() =>
    Promise.resolve({
      isAuthenticated: true,
      user: { id: "user-1" },
      workspace: { id: "ws-1" },
    })
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { id: "box-1", workspace_id: "ws-1" } }),
          }),
        }),
      }),
    })
  ),
}));

// Phase 3 introduces a workspace_operator_runs row per dispatch. The
// production action wires through createOperatorRun + updateOperatorRun;
// for these unit tests we stub them to a no-op since the contract under
// test is the action's return value, not the run-row persistence.
vi.mock("@/server/services/workspace_operator_runs_service", () => ({
  createOperatorRun: vi.fn(() =>
    Promise.resolve({
      id: "run-row-1",
      workspace_id: "ws-1",
      user_id: "user-1",
      branch_id: null,
      prompt: "stub",
      mode: "plan",
      status: "queued",
      plan: null,
      result: null,
      error: null,
      notes_created: [],
      tool_calls: 0,
      duration_ms: null,
      created_at: "2026-04-19T00:00:00Z",
      updated_at: "2026-04-19T00:00:00Z",
    })
  ),
  updateOperatorRun: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/server/services/branch_service", () => ({
  createDraftBranch: vi.fn(() =>
    Promise.resolve({ id: "branch-1", name: "agent/test" })
  ),
}));

vi.mock("@/server/repositories/audit_event_repository", () => ({
  createAuditEvent: vi.fn(() => Promise.resolve()),
}));

// Phase 4: every action now gates on checkOperatorQuota before doing
// any work. The default mock returns `allowed: true` so the existing
// happy-path tests keep passing; the quota_exceeded test below
// re-mocks to `allowed: false`.
vi.mock("@/server/services/workspace_operator_quota_service", () => ({
  OPERATOR_TIER_LIMITS: { free: 5, pro: 50, business: 500 },
  checkOperatorQuota: vi.fn(() =>
    Promise.resolve({
      tier: "free",
      limit: 5,
      used: 0,
      remaining: 5,
      allowed: true,
      resetsAt: new Date(Date.UTC(2026, 4, 1, 0, 0, 0)),
    })
  ),
  firstOfNextMonthUTC: vi.fn(() => new Date(Date.UTC(2026, 4, 1, 0, 0, 0))),
}));

vi.mock("@/server/services/workspace_operator_service", () => ({
  dispatchOperatorRun: vi.fn(),
  dispatchOperatorPlan: vi.fn(() =>
    Promise.resolve({
      run_id: "test-run",
      steps: [
        { index: 0, description: "Search context", tool: "hybrid_search" },
        { index: 1, description: "Draft brief", tool: "draft_note" },
      ],
      summary: "Search and draft",
    })
  ),
  dispatchOperatorExecute: vi.fn(() =>
    Promise.resolve({
      run_id: "test-run",
      status: "completed",
      notes_created: ["note-1"],
      tool_calls: 3,
      error: null,
    })
  ),
}));

import {
  requestOperatorPlanAction,
  approveAndExecuteAction,
} from "@/app/app/workspace_operator/actions";
import { isWorkspaceOperatorEnabled } from "@/lib/env";
import { getRequestContext } from "@/server/auth/get_request_context";
import { dispatchOperatorExecute } from "@/server/services/workspace_operator_service";
import { checkOperatorQuota } from "@/server/services/workspace_operator_quota_service";

// ---------------------------------------------------------------------------
// requestOperatorPlanAction
// ---------------------------------------------------------------------------

describe("requestOperatorPlanAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isWorkspaceOperatorEnabled).mockReturnValue(true);
    vi.mocked(getRequestContext).mockResolvedValue({
      isAuthenticated: true,
      user: { id: "user-1" },
      workspace: { id: "ws-1" },
    } as any);
  });

  it("returns plan steps with 'pending' status", async () => {
    const result = await requestOperatorPlanAction({
      prompt: "Draft a brief on Q1 roadmap",
      boxId: "box-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.steps).toHaveLength(2);
    expect(result.data.steps[0]).toEqual({
      index: 0,
      description: "Search context",
      tool: "hybrid_search",
      status: "pending",
    });
    expect(result.data.steps[1]).toEqual({
      index: 1,
      description: "Draft brief",
      tool: "draft_note",
      status: "pending",
    });
    expect(result.data.summary).toBe("Search and draft");
    expect(result.data.branch_id).toBe("branch-1");
    expect(typeof result.data.run_id).toBe("string");
  });

  it("fails when feature flag is off", async () => {
    vi.mocked(isWorkspaceOperatorEnabled).mockReturnValue(false);

    const result = await requestOperatorPlanAction({
      prompt: "Draft a brief",
      boxId: "box-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not enabled/i);
  });

  it("fails with empty prompt", async () => {
    const result = await requestOperatorPlanAction({
      prompt: "   ",
      boxId: "box-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Prompt is required/);
  });

  it("fails with prompt exceeding 4000 characters", async () => {
    const result = await requestOperatorPlanAction({
      prompt: "x".repeat(4001),
      boxId: "box-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/4000 characters/);
  });

  it("fails with empty boxId", async () => {
    const result = await requestOperatorPlanAction({
      prompt: "Draft a brief",
      boxId: "",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/boxId is required/);
  });

  it("fails when unauthenticated", async () => {
    vi.mocked(getRequestContext).mockResolvedValue({
      isAuthenticated: false,
      user: null,
      workspace: null,
    } as any);

    const result = await requestOperatorPlanAction({
      prompt: "Draft a brief",
      boxId: "box-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Unauthenticated/);
  });
});

// ---------------------------------------------------------------------------
// approveAndExecuteAction
// ---------------------------------------------------------------------------

describe("approveAndExecuteAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isWorkspaceOperatorEnabled).mockReturnValue(true);
    vi.mocked(getRequestContext).mockResolvedValue({
      isAuthenticated: true,
      user: { id: "user-1" },
      workspace: { id: "ws-1" },
    } as any);
  });

  const validInput = {
    runId: "run-1",
    branchId: "branch-1",
    boxId: "box-1",
    prompt: "Draft a brief on Q1 roadmap",
    steps: [
      { index: 0, description: "Search context", tool: "hybrid_search" },
      { index: 1, description: "Draft brief", tool: "draft_note" },
    ],
  };

  it("returns completed result", async () => {
    const result = await approveAndExecuteAction(validInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toEqual({
      run_id: "run-1",
      branch_id: "branch-1",
      status: "completed",
      notes_created: ["note-1"],
      tool_calls: 3,
      error: null,
    });
  });

  it("fails when feature flag is off", async () => {
    vi.mocked(isWorkspaceOperatorEnabled).mockReturnValue(false);

    const result = await approveAndExecuteAction(validInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not enabled/i);
  });

  it("fails with no steps", async () => {
    const result = await approveAndExecuteAction({
      ...validInput,
      steps: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/At least one plan step/);
  });

  it("fails with missing required fields", async () => {
    const result = await approveAndExecuteAction({
      ...validInput,
      runId: "",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/runId, branchId, and boxId are required/);
  });

  it("surfaces dispatch errors", async () => {
    vi.mocked(dispatchOperatorExecute).mockRejectedValueOnce(
      new Error("Modal timeout after 300s")
    );

    const result = await approveAndExecuteAction(validInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Operator execution failed/);
    expect(result.error).toMatch(/Modal timeout/);
  });

  it("fails when unauthenticated", async () => {
    vi.mocked(getRequestContext).mockResolvedValue({
      isAuthenticated: false,
      user: null,
      workspace: null,
    } as any);

    const result = await approveAndExecuteAction(validInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Unauthenticated/);
  });
});

// ---------------------------------------------------------------------------
// Phase 4: quota gating
// ---------------------------------------------------------------------------

describe("operator actions — quota gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isWorkspaceOperatorEnabled).mockReturnValue(true);
    vi.mocked(getRequestContext).mockResolvedValue({
      isAuthenticated: true,
      user: { id: "user-1", email: "user@example.com" },
      workspace: { id: "ws-1" },
    } as any);
    // Unset ADMIN_EMAILS so the user isn't flagged as an admin bypass.
    delete process.env.ADMIN_EMAILS;
  });

  it("requestOperatorPlanAction returns a structured quota_exceeded error when the user is over the cap", async () => {
    vi.mocked(checkOperatorQuota).mockResolvedValueOnce({
      tier: "free",
      limit: 5,
      used: 5,
      remaining: 0,
      allowed: false,
      resetsAt: new Date(Date.UTC(2026, 4, 1, 0, 0, 0)),
    });

    const result = await requestOperatorPlanAction({
      prompt: "Draft a brief",
      boxId: "box-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Structured error (not a bare string) so the UI can swap phases.
    expect(typeof result.error).toBe("object");
    const err = result.error as { code: string; tier: string; limit: number | null; resetsAt: string };
    expect(err.code).toBe("quota_exceeded");
    expect(err.tier).toBe("free");
    expect(err.limit).toBe(5);
    expect(typeof err.resetsAt).toBe("string");
  });

  it("approveAndExecuteAction blocks with quota_exceeded before dispatching", async () => {
    vi.mocked(checkOperatorQuota).mockResolvedValueOnce({
      tier: "pro",
      limit: 50,
      used: 50,
      remaining: 0,
      allowed: false,
      resetsAt: new Date(Date.UTC(2026, 4, 1, 0, 0, 0)),
    });

    const result = await approveAndExecuteAction({
      runId: "run-1",
      branchId: "branch-1",
      boxId: "box-1",
      prompt: "Go",
      steps: [
        { index: 0, description: "Search context", tool: "hybrid_search" },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.error as { code: string; tier: string };
    expect(err.code).toBe("quota_exceeded");
    expect(err.tier).toBe("pro");
    // Dispatch must NOT happen when the quota gate denied the request.
    expect(dispatchOperatorExecute).not.toHaveBeenCalled();
  });

  it("admin callers bypass the quota check (ADMIN_EMAILS allow-list)", async () => {
    process.env.ADMIN_EMAILS = "admin@example.com";
    vi.mocked(getRequestContext).mockResolvedValue({
      isAuthenticated: true,
      user: { id: "admin-1", email: "admin@example.com" },
      workspace: { id: "ws-1" },
    } as any);
    // If the admin bypass didn't work this would flip the action to a
    // quota error; we confirm it's *ignored* by watching the happy path.
    vi.mocked(checkOperatorQuota).mockResolvedValueOnce({
      tier: "free",
      limit: 5,
      used: 99,
      remaining: 0,
      allowed: false,
      resetsAt: new Date(Date.UTC(2026, 4, 1, 0, 0, 0)),
    });

    const result = await requestOperatorPlanAction({
      prompt: "Draft a brief",
      boxId: "box-1",
    });

    expect(result.ok).toBe(true);
  });
});
