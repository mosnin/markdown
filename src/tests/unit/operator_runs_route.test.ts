import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Tests for the REST entry point — POST /api/operator/runs.
 *
 * The route composes a long chain (env flag → bearer parse → key verify
 * → quota gate → branch resolve → box check → run row → dispatch →
 * usage rollup). We mock at the module boundary for everything below
 * the route so each assertion targets a single decision in that chain
 * rather than recreating Supabase semantics.
 */

const ENV_BACKUP = process.env;

// ─── Mocks ──────────────────────────────────────────────────────────────────
// Mocked module surface, in execution order through the route.

vi.mock("@/lib/env", () => ({
  isWorkspaceOperatorEnabled: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}));

const verifyApiKeyMock = vi.fn();
vi.mock("@/server/services/operator_api_keys_service", async () => {
  const real = await vi.importActual<
    typeof import("@/server/services/operator_api_keys_service")
  >("@/server/services/operator_api_keys_service");
  return {
    ...real,
    verifyApiKey: (...args: unknown[]) =>
      verifyApiKeyMock(...(args as Parameters<typeof real.verifyApiKey>)),
  };
});

const checkOperatorQuotaMock = vi.fn();
vi.mock("@/server/services/workspace_operator_quota_service", () => ({
  checkOperatorQuota: (...a: unknown[]) => checkOperatorQuotaMock(...a),
}));

const createOperatorRunMock = vi.fn();
const updateOperatorRunMock = vi.fn();
vi.mock("@/server/services/workspace_operator_runs_service", () => ({
  createOperatorRun: (...a: unknown[]) => createOperatorRunMock(...a),
  updateOperatorRun: (...a: unknown[]) => updateOperatorRunMock(...a),
}));

const dispatchOperatorRunMock = vi.fn();
const dispatchOperatorPlanMock = vi.fn();
const dispatchOperatorExecuteMock = vi.fn();
vi.mock("@/server/services/workspace_operator_service", () => ({
  dispatchOperatorRun: (...a: unknown[]) => dispatchOperatorRunMock(...a),
  dispatchOperatorPlan: (...a: unknown[]) => dispatchOperatorPlanMock(...a),
  dispatchOperatorExecute: (...a: unknown[]) => dispatchOperatorExecuteMock(...a),
}));

const createDraftBranchMock = vi.fn();
vi.mock("@/server/services/branch_service", () => ({
  createDraftBranch: (...a: unknown[]) => createDraftBranchMock(...a),
}));

const recordOperatorUsageMock = vi.fn();
vi.mock("@/server/services/workspace_operator_usage_service", () => ({
  recordOperatorUsage: (...a: unknown[]) => recordOperatorUsageMock(...a),
}));

// The route imports createAdminClient at the top level; the import above
// mocks it. We override the per-test admin client (with a configured
// `from()`) by re-mocking inside individual tests.

import { POST } from "@/app/api/operator/runs/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkspaceOperatorEnabled } from "@/lib/env";

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://test/api/operator/runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function asAdmin(opts: {
  branch?: { id: string; workspace_id: string; status: string } | null;
  box?: { id: string; workspace_id: string } | null;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: Record<string, any> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => {
        if (table === "draft_branches") return { data: opts.branch ?? null, error: null };
        if (table === "boxes") return { data: opts.box ?? null, error: null };
        return { data: null, error: null };
      };
      return b;
    },
  };
}

beforeEach(() => {
  process.env = { ...ENV_BACKUP };
  verifyApiKeyMock.mockReset();
  checkOperatorQuotaMock.mockReset();
  createOperatorRunMock.mockReset();
  updateOperatorRunMock.mockReset();
  dispatchOperatorRunMock.mockReset();
  dispatchOperatorPlanMock.mockReset();
  dispatchOperatorExecuteMock.mockReset();
  createDraftBranchMock.mockReset();
  recordOperatorUsageMock.mockReset();
  (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReset();
  (isWorkspaceOperatorEnabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
});

afterEach(() => {
  process.env = ENV_BACKUP;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/operator/runs — auth", () => {
  it("503 when the operator is not enabled", async () => {
    (isWorkspaceOperatorEnabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const res = await POST(makeRequest({ prompt: "x", mode: "full", boxId: "b" }) as never);
    expect(res.status).toBe(503);
  });

  it("401 when the Authorization header is missing", async () => {
    const res = await POST(makeRequest({ prompt: "x", mode: "full", boxId: "b" }) as never);
    expect(res.status).toBe(401);
  });

  it("401 when the bearer key fails verification", async () => {
    verifyApiKeyMock.mockResolvedValueOnce(null);
    const res = await POST(
      makeRequest(
        { prompt: "x", mode: "full", boxId: "b" },
        { Authorization: "Bearer wopr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
      ) as never
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/operator/runs — input validation", () => {
  beforeEach(() => {
    verifyApiKeyMock.mockResolvedValue({ userId: "u-1", workspaceId: "ws-1" });
  });

  it("400 when prompt is missing", async () => {
    const res = await POST(
      makeRequest(
        { mode: "full", boxId: "b" },
        { Authorization: "Bearer wopr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
      ) as never
    );
    expect(res.status).toBe(400);
  });

  it("400 when mode is unknown", async () => {
    const res = await POST(
      makeRequest(
        { prompt: "x", mode: "explode", boxId: "b" },
        { Authorization: "Bearer wopr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
      ) as never
    );
    expect(res.status).toBe(400);
  });

  it("400 when mode is full and boxId is missing", async () => {
    const res = await POST(
      makeRequest(
        { prompt: "x", mode: "full" },
        { Authorization: "Bearer wopr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
      ) as never
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/operator/runs — quota gate", () => {
  beforeEach(() => {
    verifyApiKeyMock.mockResolvedValue({ userId: "u-1", workspaceId: "ws-1" });
    (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      asAdmin({
        branch: { id: "br-1", workspace_id: "ws-1", status: "open" },
        box: { id: "b-1", workspace_id: "ws-1" },
      })
    );
  });

  it("returns 429 quota_exceeded when checkOperatorQuota denies", async () => {
    checkOperatorQuotaMock.mockResolvedValueOnce({
      tier: "pro",
      limit: 50,
      used: 50,
      remaining: 0,
      allowed: false,
      resetsAt: new Date("2026-05-01T00:00:00Z"),
    });
    const res = await POST(
      makeRequest(
        {
          prompt: "do work",
          mode: "full",
          boxId: "b-1",
          branchId: "br-1",
        },
        { Authorization: "Bearer wopr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
      ) as never
    );
    expect(res.status).toBe(429);
    const json = (await res.json()) as { error_code: string };
    expect(json.error_code).toBe("quota_exceeded");
    // We must not have created the run row when quota denied us — the
    // REST endpoint's "must NOT bypass quota" invariant.
    expect(createOperatorRunMock).not.toHaveBeenCalled();
    expect(dispatchOperatorRunMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/operator/runs — happy path", () => {
  beforeEach(() => {
    verifyApiKeyMock.mockResolvedValue({ userId: "u-1", workspaceId: "ws-1" });
    (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      asAdmin({
        branch: { id: "br-1", workspace_id: "ws-1", status: "open" },
        box: { id: "b-1", workspace_id: "ws-1" },
      })
    );
    checkOperatorQuotaMock.mockResolvedValue({
      tier: "pro",
      limit: 50,
      used: 0,
      remaining: 50,
      allowed: true,
      resetsAt: new Date("2026-05-01T00:00:00Z"),
    });
    createOperatorRunMock.mockResolvedValue({
      id: "run-1",
      workspace_id: "ws-1",
      user_id: "u-1",
      branch_id: "br-1",
      prompt: "do work",
      mode: "full",
      status: "queued",
      notes_created: [],
      tool_calls: 0,
    });
    updateOperatorRunMock.mockResolvedValue(undefined);
    dispatchOperatorRunMock.mockResolvedValue({
      run_id: "run-1",
      status: "completed",
      notes_created: ["n-1", "n-2"],
      tool_calls: 3,
      error: null,
    });
    recordOperatorUsageMock.mockResolvedValue(undefined);
  });

  it("returns 200 with run details on a successful full-mode dispatch", async () => {
    const res = await POST(
      makeRequest(
        {
          prompt: "do work",
          mode: "full",
          boxId: "b-1",
          branchId: "br-1",
        },
        { Authorization: "Bearer wopr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
      ) as never
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { run_id: string; status: string } };
    expect(json.data.run_id).toBe("run-1");
    expect(json.data.status).toBe("completed");

    // Quota was checked, run was created with the verified userId, dispatch
    // was called with the resolved branch, and usage was recorded.
    expect(checkOperatorQuotaMock).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "u-1", workspaceId: "ws-1" }
    );
    expect(createOperatorRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "ws-1",
        userId: "u-1",
        branchId: "br-1",
        mode: "full",
      })
    );
    expect(dispatchOperatorRunMock).toHaveBeenCalled();
    expect(recordOperatorUsageMock).toHaveBeenCalled();
  });
});
