import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mock dependencies before imports
// ---------------------------------------------------------------------------

const mockSend = vi.fn((_payload: any) => Promise.resolve());
const mockChannel = vi.fn((_name: string) => ({ send: mockSend }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ channel: mockChannel }),
}));

vi.mock("@/app/api/agent/_lib/auth", () => ({
  verifyAgentRequest: vi.fn(),
}));

import { POST } from "@/app/api/agent/tools/progress/route";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/agent/tools/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/agent/tools/progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests with invalid secret (403)", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "invalid_secret" },
    } as any);

    const res = await POST(
      makeRequest({ run_id: "r-1", type: "step_start" })
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error_code).toBe("invalid_secret");
  });

  it("rejects requests with feature disabled (400)", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "feature_disabled" },
    } as any);

    const res = await POST(
      makeRequest({ run_id: "r-1", type: "step_start" })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error_code).toBe("feature_disabled");
  });

  it("rejects requests with missing run_id (400)", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: true,
      ctx: {
        userId: "user-1",
        workspaceId: "ws-1",
        branchId: "branch-1",
        runId: "run-1",
      },
    } as any);

    const res = await POST(makeRequest({ type: "step_start" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error_code).toBe("missing_fields");
    expect(json.message).toMatch(/run_id and type are required/);
  });

  it("rejects requests with missing type (400)", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: true,
      ctx: {
        userId: "user-1",
        workspaceId: "ws-1",
        branchId: "branch-1",
        runId: "run-1",
      },
    } as any);

    const res = await POST(makeRequest({ run_id: "r-1" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error_code).toBe("missing_fields");
  });

  it("broadcasts progress event via Supabase channel on valid request", async () => {
    // The route derives run_id from the authenticated envelope and rejects a
    // body whose run_id disagrees (defense-in-depth, route.ts:62), so the
    // request body's run_id must match ctx.runId.
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: true,
      ctx: {
        userId: "user-1",
        workspaceId: "ws-1",
        branchId: "branch-1",
        runId: "run-1",
      },
    } as any);

    const res = await POST(
      makeRequest({
        run_id: "run-1",
        type: "step_complete",
        step_index: 2,
        detail: "Finished search",
      })
    );

    expect(res.status).toBe(200);

    // Channel name is derived from the authenticated ctx.runId.
    expect(mockChannel).toHaveBeenCalledWith("operator_run:run-1");

    // Verify the broadcast payload
    expect(mockSend).toHaveBeenCalledTimes(1);
    const sendArg = mockSend.mock.calls[0][0] as Record<string, unknown>;
    expect(sendArg.type).toBe("broadcast");
    expect(sendArg.event).toBe("progress");

    const payload = sendArg.payload as Record<string, unknown>;
    expect(payload.run_id).toBe("run-1");
    expect(payload.type).toBe("step_complete");
    expect(payload.step_index).toBe(2);
    expect(payload.detail).toBe("Finished search");
    expect(typeof payload.timestamp).toBe("string");
  });

  it("returns 200 with { data: { received: true } }", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: true,
      ctx: {
        userId: "user-1",
        workspaceId: "ws-1",
        branchId: "branch-1",
        runId: "run-1",
      },
    } as any);

    const res = await POST(
      makeRequest({ run_id: "run-1", type: "completed" })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ received: true });
    expect(json.meta.request_id).toBe("run-1");
  });

  it("defaults step_index and detail to null when omitted", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: true,
      ctx: {
        userId: "user-1",
        workspaceId: "ws-1",
        branchId: "branch-1",
        runId: "run-1",
      },
    } as any);

    await POST(makeRequest({ run_id: "run-1", type: "completed" }));

    const payload = (mockSend.mock.calls[0][0] as any).payload;
    expect(payload.step_index).toBeNull();
    expect(payload.detail).toBeNull();
  });

  it("uses provided timestamp when present", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: true,
      ctx: {
        userId: "user-1",
        workspaceId: "ws-1",
        branchId: "branch-1",
        runId: "run-1",
      },
    } as any);

    const ts = "2026-04-19T12:00:00.000Z";
    await POST(
      makeRequest({ run_id: "run-1", type: "step_start", timestamp: ts })
    );

    const payload = (mockSend.mock.calls[0][0] as any).payload;
    expect(payload.timestamp).toBe(ts);
  });
});
