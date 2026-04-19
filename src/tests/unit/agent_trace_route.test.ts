import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mock dependencies before imports — vi.hoisted runs before imports so the
// mocks can capture the same fn instances we assert on below.
// ---------------------------------------------------------------------------

const { mockCreateAuditEvent, mockChannel, mockChannelSend } = vi.hoisted(() => {
  const send = vi.fn(async (_payload: any) => ({ ok: true }));
  return {
    mockCreateAuditEvent: vi.fn(async (_supabase: any, _input: any) => ({
      id: "audit-1",
      workspace_id: "ws-1",
    })),
    mockChannelSend: send,
    mockChannel: vi.fn((_name: string) => ({ send })),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ channel: mockChannel }),
}));

vi.mock("@/server/repositories/audit_event_repository", () => ({
  createAuditEvent: mockCreateAuditEvent,
}));

vi.mock("@/app/api/agent/_lib/auth", () => ({
  verifyAgentRequest: vi.fn(),
}));

import { POST } from "@/app/api/agent/tools/trace/route";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/agent/tools/trace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const RUN_ID = "run-trace-0001";
const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "00000000-0000-0000-0000-000000000001";

function authOk(): void {
  vi.mocked(verifyAgentRequest).mockReturnValue({
    ok: true,
    ctx: {
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      branchId: "22222222-2222-2222-2222-222222222222",
      runId: RUN_ID,
    },
  } as any);
}

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: RUN_ID,
    span_id: "span-1",
    parent_id: null,
    name: "hybrid_search",
    kind: "tool_call",
    started_at: "2026-04-19T12:00:00.000Z",
    ended_at: "2026-04-19T12:00:00.123Z",
    duration_ms: 123,
    metadata: { tool: "hybrid_search" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/agent/tools/trace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests with invalid secret (403)", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "invalid_secret" },
    } as any);

    const res = await POST(makeRequest(makeEvent()));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error_code).toBe("invalid_secret");
    expect(mockCreateAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects requests with feature disabled (400)", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "feature_disabled" },
    } as any);

    const res = await POST(makeRequest(makeEvent()));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error_code).toBe("feature_disabled");
  });

  it("rejects requests with malformed JSON body (400)", async () => {
    authOk();
    const req = new NextRequest("http://localhost/api/agent/tools/trace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects requests with no run_id and no events array (400)", async () => {
    authOk();
    const res = await POST(makeRequest({ name: "x", kind: "tool_call" }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error_code).toBe("bad_request");
  });

  it("rejects events whose run_id does not match the envelope (400)", async () => {
    authOk();
    const res = await POST(
      makeRequest(makeEvent({ run_id: "wrong-run-id" }))
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.message).toMatch(/run_id does not match/);
    expect(mockCreateAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects empty events array (400)", async () => {
    authOk();
    const res = await POST(makeRequest({ events: [] }));
    expect(res.status).toBe(400);
  });

  it("happy path: single event writes one audit_event and returns 200", async () => {
    authOk();
    const res = await POST(makeRequest(makeEvent()));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.run_id).toBe(RUN_ID);
    expect(json.data.received).toBe(1);
    expect(json.data.written).toBe(1);

    expect(mockCreateAuditEvent).toHaveBeenCalledTimes(1);
    const [, input] = mockCreateAuditEvent.mock.calls[0];
    expect(input.workspace_id).toBe(WORKSPACE_ID);
    expect(input.actor_type).toBe("system");
    expect(input.actor_id).toBe("workspace_operator");
    expect(input.object_type).toBe("agent_run");
    expect(input.object_id).toBe(RUN_ID);
    expect(input.event_type).toBe("agent.trace.tool_call");
    expect(input.metadata.span_id).toBe("span-1");
    expect(input.metadata.duration_ms).toBe(123);
    expect(input.metadata.span_metadata).toEqual({ tool: "hybrid_search" });
  });

  it("happy path: batch events writes one audit_event per event", async () => {
    authOk();
    const events = [
      makeEvent({ span_id: "s1", kind: "llm_call", name: "openai.chat" }),
      makeEvent({ span_id: "s2", kind: "tool_call", name: "draft_note" }),
      makeEvent({ span_id: "s3", kind: "tool_call", name: "hybrid_search" }),
    ];
    const res = await POST(makeRequest({ events }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.received).toBe(3);
    expect(json.data.written).toBe(3);

    expect(mockCreateAuditEvent).toHaveBeenCalledTimes(3);
    const eventTypes = mockCreateAuditEvent.mock.calls.map(
      ([, input]) => input.event_type
    );
    expect(eventTypes).toEqual([
      "agent.trace.llm_call",
      "agent.trace.tool_call",
      "agent.trace.tool_call",
    ]);
  });

  it("interesting events (trace_root) trigger an activity_feed broadcast", async () => {
    authOk();
    const res = await POST(
      makeRequest(makeEvent({ kind: "trace_root", name: "workspace_operator" }))
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.broadcast).toBe(1);

    expect(mockChannel).toHaveBeenCalledWith(`activity_feed:${WORKSPACE_ID}`);
    expect(mockChannelSend).toHaveBeenCalledTimes(1);
    const sendArg = mockChannelSend.mock.calls[0][0] as Record<string, unknown>;
    expect(sendArg.type).toBe("broadcast");
    expect(sendArg.event).toBe("agent_trace");
    const payload = sendArg.payload as Record<string, unknown>;
    expect(payload.run_id).toBe(RUN_ID);
    expect(payload.kind).toBe("trace_root");
  });

  it("interesting events (guardrail name) trigger an activity_feed broadcast", async () => {
    authOk();
    const res = await POST(
      makeRequest(
        makeEvent({ kind: "tool_call", name: "cite_guardrail_check" })
      )
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.broadcast).toBe(1);
    expect(mockChannelSend).toHaveBeenCalledTimes(1);
  });

  it("noisy events (llm_call) do NOT trigger a broadcast", async () => {
    authOk();
    const res = await POST(
      makeRequest(makeEvent({ kind: "llm_call", name: "openai.chat" }))
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.broadcast).toBe(0);
    expect(mockChannelSend).not.toHaveBeenCalled();
    // But audit row is still written.
    expect(mockCreateAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("partial-failure path: continues on per-event audit error", async () => {
    authOk();
    let callCount = 0;
    mockCreateAuditEvent.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 2) {
        throw new Error("simulated db failure");
      }
      return { id: `audit-${callCount}`, workspace_id: WORKSPACE_ID };
    });

    const events = [
      makeEvent({ span_id: "s1" }),
      makeEvent({ span_id: "s2" }),
      makeEvent({ span_id: "s3" }),
    ];
    const res = await POST(makeRequest({ events }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.received).toBe(3);
    expect(json.data.written).toBe(2);
  });
});
