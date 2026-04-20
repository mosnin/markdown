import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Tests for the REST cancel endpoint — `POST /api/operator/runs/[id]/cancel`.
 *
 * This closes the Workspace Operator gap where API clients had no way to
 * cancel an in-flight run (the cookie-session UI had `cancelRunAction`,
 * automation / CI did not). The route flips the same
 * `cancellation_requested_at` column the cookie action writes, which the
 * Modal Python operator polls via `/api/agent/operator/check_cancel`.
 *
 * Mock strategy: same layering as `operator_runs_route.test.ts` — we mock
 * at the module boundary for verifyApiKey, getOperatorRun, updateOperatorRun,
 * and the admin client so each test asserts one decision in the auth →
 * load → idempotency → write chain.
 */

// ─── Mocks ──────────────────────────────────────────────────────────────────

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

const getOperatorRunMock = vi.fn();
const updateOperatorRunMock = vi.fn();
vi.mock("@/server/services/workspace_operator_runs_service", () => ({
  getOperatorRun: (...a: unknown[]) => getOperatorRunMock(...a),
  updateOperatorRun: (...a: unknown[]) => updateOperatorRunMock(...a),
}));

import { POST } from "@/app/api/operator/runs/[id]/cancel/route";
import { isWorkspaceOperatorEnabled } from "@/lib/env";

const WS_A = "11111111-1111-1111-1111-111111111111";
const WS_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "00000000-0000-0000-0000-000000000001";
const RUN_ID = "abcdef12-3456-7890-abcd-ef1234567890";
const VALID_BEARER = "Bearer wopr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request(`http://test/api/operator/runs/${RUN_ID}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  verifyApiKeyMock.mockReset();
  getOperatorRunMock.mockReset();
  updateOperatorRunMock.mockReset();
  (isWorkspaceOperatorEnabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    true
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/operator/runs/[id]/cancel — auth", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await POST(makeRequest() as never, makeParams(RUN_ID));
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error_code: string };
    expect(json.error_code).toBe("unauthorized");
    // No DB call made — auth denied before load.
    expect(getOperatorRunMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer key fails verification", async () => {
    verifyApiKeyMock.mockResolvedValueOnce(null);
    const res = await POST(
      makeRequest({ Authorization: VALID_BEARER }) as never,
      makeParams(RUN_ID)
    );
    expect(res.status).toBe(401);
    expect(getOperatorRunMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the operator feature flag is disabled", async () => {
    (isWorkspaceOperatorEnabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      false
    );
    const res = await POST(
      makeRequest({ Authorization: VALID_BEARER }) as never,
      makeParams(RUN_ID)
    );
    expect(res.status).toBe(503);
  });
});

describe("POST /api/operator/runs/[id]/cancel — id validation", () => {
  beforeEach(() => {
    verifyApiKeyMock.mockResolvedValue({
      id: "key-1",
      userId: USER_A,
      workspaceId: WS_A,
    });
  });

  it("returns 404 for a malformed (non-UUID) id without hitting the DB", async () => {
    const res = await POST(
      makeRequest({ Authorization: VALID_BEARER }) as never,
      makeParams("not-a-uuid")
    );
    expect(res.status).toBe(404);
    expect(getOperatorRunMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the run belongs to a different workspace (no 403)", async () => {
    getOperatorRunMock.mockResolvedValueOnce({
      id: RUN_ID,
      workspace_id: WS_B, // different workspace
      user_id: USER_A,
      status: "executing",
      cancellation_requested_at: null,
    });
    const res = await POST(
      makeRequest({ Authorization: VALID_BEARER }) as never,
      makeParams(RUN_ID)
    );
    // Cross-workspace runs return 404 (not 403) — mirrors the GET [id] route
    // information-disclosure stance.
    expect(res.status).toBe(404);
    expect(updateOperatorRunMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the run does not exist", async () => {
    getOperatorRunMock.mockResolvedValueOnce(null);
    const res = await POST(
      makeRequest({ Authorization: VALID_BEARER }) as never,
      makeParams(RUN_ID)
    );
    expect(res.status).toBe(404);
    expect(updateOperatorRunMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/operator/runs/[id]/cancel — active run", () => {
  beforeEach(() => {
    verifyApiKeyMock.mockResolvedValue({
      id: "key-1",
      userId: USER_A,
      workspaceId: WS_A,
    });
  });

  it("returns 200 cancelled:true, already_cancelled:false for an executing run", async () => {
    getOperatorRunMock.mockResolvedValueOnce({
      id: RUN_ID,
      workspace_id: WS_A,
      user_id: USER_A,
      status: "executing",
      cancellation_requested_at: null,
    });
    updateOperatorRunMock.mockResolvedValueOnce(undefined);

    const res = await POST(
      makeRequest({ Authorization: VALID_BEARER }) as never,
      makeParams(RUN_ID)
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { cancelled: boolean; already_cancelled: boolean; status: string };
    };
    expect(json.data.cancelled).toBe(true);
    expect(json.data.already_cancelled).toBe(false);
    expect(json.data.status).toBe("cancel_requested");

    // DB write actually happened, with an ISO timestamp.
    expect(updateOperatorRunMock).toHaveBeenCalledTimes(1);
    const patch = updateOperatorRunMock.mock.calls[0]![2] as {
      cancellationRequestedAt: string;
    };
    expect(typeof patch.cancellationRequestedAt).toBe("string");
    expect(Number.isFinite(Date.parse(patch.cancellationRequestedAt))).toBe(true);
  });

  it.each(["pending", "planning", "awaiting_approval", "executing"] as const)(
    "flips the cancel flag for active status=%s",
    async (status) => {
      getOperatorRunMock.mockResolvedValueOnce({
        id: RUN_ID,
        workspace_id: WS_A,
        user_id: USER_A,
        status,
        cancellation_requested_at: null,
      });
      updateOperatorRunMock.mockResolvedValueOnce(undefined);
      const res = await POST(
        makeRequest({ Authorization: VALID_BEARER }) as never,
        makeParams(RUN_ID)
      );
      expect(res.status).toBe(200);
      expect(updateOperatorRunMock).toHaveBeenCalledTimes(1);
    }
  );
});

describe("POST /api/operator/runs/[id]/cancel — idempotent / terminal", () => {
  beforeEach(() => {
    verifyApiKeyMock.mockResolvedValue({
      id: "key-1",
      userId: USER_A,
      workspaceId: WS_A,
    });
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "returns 200 already_cancelled:true for terminal status=%s without DB write",
    async (status) => {
      getOperatorRunMock.mockResolvedValueOnce({
        id: RUN_ID,
        workspace_id: WS_A,
        user_id: USER_A,
        status,
        cancellation_requested_at:
          status === "cancelled" ? "2026-04-20T00:00:00.000Z" : null,
      });

      const res = await POST(
        makeRequest({ Authorization: VALID_BEARER }) as never,
        makeParams(RUN_ID)
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        data: { cancelled: boolean; already_cancelled: boolean; status: string };
      };
      expect(json.data.cancelled).toBe(true);
      expect(json.data.already_cancelled).toBe(true);
      expect(json.data.status).toBe(status);
      // Idempotency invariant: never write against a terminal run.
      expect(updateOperatorRunMock).not.toHaveBeenCalled();
    }
  );

  it("returns already_cancelled:true when cancellation was previously requested", async () => {
    getOperatorRunMock.mockResolvedValueOnce({
      id: RUN_ID,
      workspace_id: WS_A,
      user_id: USER_A,
      status: "executing",
      cancellation_requested_at: "2026-04-20T00:00:00.000Z",
    });

    const res = await POST(
      makeRequest({ Authorization: VALID_BEARER }) as never,
      makeParams(RUN_ID)
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { already_cancelled: boolean };
    };
    expect(json.data.already_cancelled).toBe(true);
    // We don't refresh the timestamp — first flip is authoritative.
    expect(updateOperatorRunMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/operator/runs/[id]/cancel — errors", () => {
  beforeEach(() => {
    verifyApiKeyMock.mockResolvedValue({
      id: "key-1",
      userId: USER_A,
      workspaceId: WS_A,
    });
  });

  it("returns 500 when getOperatorRun throws", async () => {
    getOperatorRunMock.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(
      makeRequest({ Authorization: VALID_BEARER }) as never,
      makeParams(RUN_ID)
    );
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error_code: string };
    expect(json.error_code).toBe("internal_error");
  });

  it("returns 500 when updateOperatorRun throws mid-write", async () => {
    getOperatorRunMock.mockResolvedValueOnce({
      id: RUN_ID,
      workspace_id: WS_A,
      user_id: USER_A,
      status: "executing",
      cancellation_requested_at: null,
    });
    updateOperatorRunMock.mockRejectedValueOnce(new Error("update failed"));
    const res = await POST(
      makeRequest({ Authorization: VALID_BEARER }) as never,
      makeParams(RUN_ID)
    );
    expect(res.status).toBe(500);
  });
});
