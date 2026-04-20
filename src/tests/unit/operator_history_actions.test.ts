import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Contract tests for the history server actions in
// src/app/app/workspace_operator/history_actions.ts.
//
// We mock @/lib/supabase/server and @/server/auth/get_request_context plus
// the relevant services, then assert:
//
//   1. listMyOperatorRunsAction filters to the current (workspace, user)
//      pair and returns the rows the service produced.
//   2. getOperatorRunDetailAction returns "Not found" when the run row's
//      user_id or workspace_id doesn't match the request context.
//   3. rollbackOperatorRunAction calls rollbackRun with the current user
//      id and propagates the {rolledBack, alreadyDeleted} payload.
//
// These mirror the operator_panel_quota.test.tsx style — no jsdom/DOM,
// just plain function-call assertions.
// ---------------------------------------------------------------------------

vi.mock("@/server/auth/get_request_context", () => ({
  getRequestContext: vi.fn(() =>
    Promise.resolve({
      isAuthenticated: true,
      user: { id: "user-1", email: "user@example.com" },
      workspace: { id: "ws-1" },
    })
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/server/services/workspace_operator_runs_service", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/services/workspace_operator_runs_service")
  >("@/server/services/workspace_operator_runs_service");
  return {
    ...actual,
    listOperatorRuns: vi.fn(async () => ({
      rows: [],
      nextCursor: null,
    })),
    getOperatorRun: vi.fn(async () => null),
  };
});

vi.mock("@/server/services/operator_artifacts_service", () => ({
  listRunArtifacts: vi.fn(async () => []),
  rollbackRun: vi.fn(async () => ({
    total: 2,
    rolledBack: 2,
    alreadyDeleted: 0,
    errors: {},
  })),
}));

import {
  listMyOperatorRunsAction,
  getOperatorRunDetailAction,
  rollbackOperatorRunAction,
} from "@/app/app/workspace_operator/history_actions";
import {
  listOperatorRuns,
  getOperatorRun,
  type WorkspaceOperatorRunRow,
} from "@/server/services/workspace_operator_runs_service";
import {
  rollbackRun,
} from "@/server/services/operator_artifacts_service";
import { getRequestContext } from "@/server/auth/get_request_context";

function buildRow(
  overrides: Partial<WorkspaceOperatorRunRow> = {}
): WorkspaceOperatorRunRow {
  return {
    id: "run-1",
    workspace_id: "ws-1",
    user_id: "user-1",
    branch_id: "branch-1",
    prompt: "Hello",
    mode: "full",
    status: "completed",
    plan: null,
    result: { summary: "ok" },
    error: null,
    notes_created: ["note-1"],
    tool_calls: 3,
    duration_ms: 1200,
    input_tokens: 100,
    output_tokens: 50,
    cached_input_tokens: 0,
    model: "gpt-4.1-mini",
    cancellation_requested_at: null,
    max_input_tokens: null,
    max_output_tokens: null,
    created_at: "2026-04-19T00:00:00Z",
    updated_at: "2026-04-19T00:00:01Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRequestContext).mockResolvedValue({
    isAuthenticated: true,
    user: { id: "user-1", email: "user@example.com" },
    workspace: { id: "ws-1" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
});

// ─── listMyOperatorRunsAction ───────────────────────────────────────────────

describe("listMyOperatorRunsAction", () => {
  it("filters by both workspaceId and userId from the request context", async () => {
    const row = buildRow();
    vi.mocked(listOperatorRuns).mockResolvedValueOnce({
      rows: [row],
      nextCursor: "2026-04-18T00:00:00Z",
    });
    const res = await listMyOperatorRunsAction({ cursor: null });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows).toEqual([row]);
    expect(res.data.nextCursor).toBe("2026-04-18T00:00:00Z");
    // Defence in depth: the action MUST scope to the caller, not just
    // trust RLS. Drift here would silently surface other users' rows.
    expect(listOperatorRuns).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "ws-1",
        userId: "user-1",
        limit: undefined,
        cursor: null,
      })
    );
  });

  it("returns ok:false when unauthenticated", async () => {
    vi.mocked(getRequestContext).mockResolvedValueOnce({
      isAuthenticated: false,
      user: null,
      workspace: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await listMyOperatorRunsAction();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/Unauthenticated/);
    expect(listOperatorRuns).not.toHaveBeenCalled();
  });
});

// ─── getOperatorRunDetailAction ─────────────────────────────────────────────

describe("getOperatorRunDetailAction ownership check", () => {
  it("returns Not found when the run is owned by another user", async () => {
    vi.mocked(getOperatorRun).mockResolvedValueOnce(
      buildRow({ user_id: "user-OTHER" })
    );
    const res = await getOperatorRunDetailAction("run-1");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("Not found");
  });

  it("returns Not found when the run is in another workspace", async () => {
    vi.mocked(getOperatorRun).mockResolvedValueOnce(
      buildRow({ workspace_id: "ws-OTHER" })
    );
    const res = await getOperatorRunDetailAction("run-1");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("Not found");
  });

  it("returns Not found when the row is missing", async () => {
    vi.mocked(getOperatorRun).mockResolvedValueOnce(null);
    const res = await getOperatorRunDetailAction("run-1");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("Not found");
  });

  it("returns ok with run + artifacts when the row is owned by the caller", async () => {
    vi.mocked(getOperatorRun).mockResolvedValueOnce(buildRow());
    const res = await getOperatorRunDetailAction("run-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.run.id).toBe("run-1");
    expect(Array.isArray(res.data.artifacts)).toBe(true);
  });
});

// ─── rollbackOperatorRunAction ──────────────────────────────────────────────

describe("rollbackOperatorRunAction", () => {
  it("calls rollbackRun with the current user id and surfaces the result", async () => {
    const res = await rollbackOperatorRunAction("run-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rolledBack).toBe(2);
    expect(rollbackRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      "user-1"
    );
  });

  it("requires a runId", async () => {
    const res = await rollbackOperatorRunAction("");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/runId/);
    expect(rollbackRun).not.toHaveBeenCalled();
  });

  it("propagates ownership errors thrown by the service", async () => {
    vi.mocked(rollbackRun).mockRejectedValueOnce(
      new Error("You can only rollback runs you started")
    );
    const res = await rollbackOperatorRunAction("run-1");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/rollback runs you started/);
  });
});
