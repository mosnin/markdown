import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Wave 1 F — `GET /api/agent/operator/check_cancel?run_id=...`
 *
 * The Modal Python operator polls this endpoint between phases (and
 * periodically inside long execute runs). Returns `{ cancelled: <bool> }`
 * keyed off the `cancellation_requested_at` column.
 */

const { mockMaybeSingle } = vi.hoisted(() => {
  return {
    // Loose typing: tests assign specific row shapes via mockResolvedValue.
    mockMaybeSingle: vi.fn() as ReturnType<typeof vi.fn>,
  };
});

vi.mock("@/lib/supabase/admin", () => {
  return {
    createAdminClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: mockMaybeSingle,
            }),
          }),
        }),
      }),
    }),
  };
});

vi.mock("@/app/api/agent/_lib/auth", () => ({
  verifyAgentRequest: vi.fn(),
}));

import { GET } from "@/app/api/agent/operator/check_cancel/route";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

const RUN_ID = "abcdef12-3456-7890-abcd-ef1234567890";
const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "00000000-0000-0000-0000-000000000001";

function makeRequest(runId?: string): NextRequest {
  const url = runId
    ? `http://localhost/api/agent/operator/check_cancel?run_id=${runId}`
    : "http://localhost/api/agent/operator/check_cancel";
  return new NextRequest(url, { method: "GET" });
}

function authOk(): void {
  vi.mocked(verifyAgentRequest).mockReturnValue({
    ok: true,
    ctx: {
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      branchId: "22222222-2222-2222-2222-222222222222",
      runId: RUN_ID,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

describe("GET /api/agent/operator/check_cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeSingle.mockReset();
  });

  it("returns cancelled=true when cancellation_requested_at is set", async () => {
    authOk();
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: RUN_ID,
        workspace_id: WORKSPACE_ID,
        cancellation_requested_at: "2026-04-20T00:00:00.000Z",
        status: "executing",
      },
      error: null,
    });
    const res = await GET(makeRequest(RUN_ID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.cancelled).toBe(true);
    expect(json.data.run_id).toBe(RUN_ID);
  });

  it("returns cancelled=false when cancellation_requested_at is null", async () => {
    authOk();
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: RUN_ID,
        workspace_id: WORKSPACE_ID,
        cancellation_requested_at: null,
        status: "executing",
      },
      error: null,
    });
    const res = await GET(makeRequest(RUN_ID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.cancelled).toBe(false);
  });

  it("returns cancelled=false (not 404) for unknown run ids", async () => {
    // Lookup misses can be transient mid-dispatch — the operator shouldn't
    // crash. Treat absence as 'not cancelled, keep going'.
    authOk();
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await GET(makeRequest(RUN_ID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.cancelled).toBe(false);
  });

  it("rejects requests without run_id query param (400)", async () => {
    authOk();
    const res = await GET(makeRequest(undefined));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error_code).toBe("bad_request");
  });

  it("rejects unauthorized requests (401 invalid_secret)", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "invalid_secret" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await GET(makeRequest(RUN_ID));
    expect(res.status).toBe(401);
  });

  it("rejects when feature is disabled (404)", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "feature_disabled" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await GET(makeRequest(RUN_ID));
    expect(res.status).toBe(404);
  });

  it("returns 500 if the supabase call throws", async () => {
    authOk();
    mockMaybeSingle.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest(RUN_ID));
    expect(res.status).toBe(500);
  });
});
