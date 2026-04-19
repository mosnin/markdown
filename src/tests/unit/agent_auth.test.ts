import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { verifyAgentRequest, AGENT_HEADERS } from "@/app/api/agent/_lib/auth";

/**
 * Tests for the Workspace Operator shared-secret + envelope verifier.
 *
 * The auth helper is the trust boundary between the Modal-deployed agent
 * and Poggle's internal API surface. Every failure mode must return a
 * discriminated tag the route handler can translate to a precise response.
 */

const VALID_SECRET = "test-shared-secret-abcdefghijklmn";
const VALID_USER_ID = "00000000-0000-0000-0000-000000000001";
const VALID_WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const VALID_BRANCH_ID = "22222222-2222-2222-2222-222222222222";
const VALID_RUN_ID = "abcdef1234567890";

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/agent/tools/search", {
    method: "POST",
    headers,
  });
}

function enabledEnv(): Record<string, string> {
  return {
    WORKSPACE_OPERATOR_ENABLED: "true",
    WORKSPACE_OPERATOR_URL: "https://agent.modal.run/invoke",
    WORKSPACE_OPERATOR_SHARED_SECRET: VALID_SECRET,
  };
}

function envelopeHeaders(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    [AGENT_HEADERS.SECRET]: VALID_SECRET,
    [AGENT_HEADERS.USER_ID]: VALID_USER_ID,
    [AGENT_HEADERS.WORKSPACE_ID]: VALID_WORKSPACE_ID,
    [AGENT_HEADERS.BRANCH_ID]: VALID_BRANCH_ID,
    [AGENT_HEADERS.RUN_ID]: VALID_RUN_ID,
    ...overrides,
  };
}

const originalEnv = { ...process.env };

describe("verifyAgentRequest", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, ...enabledEnv() };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("accepts a well-formed request and returns the envelope", () => {
    const req = makeRequest(envelopeHeaders());
    const result = verifyAgentRequest(req);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ctx.userId).toBe(VALID_USER_ID);
    expect(result.ctx.workspaceId).toBe(VALID_WORKSPACE_ID);
    expect(result.ctx.branchId).toBe(VALID_BRANCH_ID);
    expect(result.ctx.runId).toBe(VALID_RUN_ID);
  });

  it("rejects when the feature flag is off", () => {
    process.env.WORKSPACE_OPERATOR_ENABLED = "false";
    const req = makeRequest(envelopeHeaders());
    const result = verifyAgentRequest(req);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("feature_disabled");
  });

  it("rejects when the flag is on but url+secret env vars are not set", () => {
    delete process.env.WORKSPACE_OPERATOR_URL;
    const req = makeRequest(envelopeHeaders());
    const result = verifyAgentRequest(req);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // isWorkspaceOperatorEnabled returns false → reports feature_disabled
    expect(result.failure.kind).toBe("feature_disabled");
  });

  it("rejects requests without the shared secret header", () => {
    const headers = envelopeHeaders();
    delete headers[AGENT_HEADERS.SECRET];
    const result = verifyAgentRequest(makeRequest(headers));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("invalid_secret");
  });

  it("rejects a wrong shared secret", () => {
    const result = verifyAgentRequest(
      makeRequest(envelopeHeaders({ [AGENT_HEADERS.SECRET]: "wrong-secret-definitely-no" }))
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("invalid_secret");
  });

  it("rejects a secret of a different length in constant time", () => {
    // Different lengths should short-circuit to false without tripping
    // timingSafeEqual's length assertion.
    const result = verifyAgentRequest(
      makeRequest(envelopeHeaders({ [AGENT_HEADERS.SECRET]: "short" }))
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("invalid_secret");
  });

  it("rejects missing user_id", () => {
    const headers = envelopeHeaders();
    delete headers[AGENT_HEADERS.USER_ID];
    const result = verifyAgentRequest(makeRequest(headers));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("missing_envelope");
    if (result.failure.kind !== "missing_envelope") return;
    expect(result.failure.field).toBe("user_id");
  });

  it("rejects missing workspace_id", () => {
    const headers = envelopeHeaders();
    delete headers[AGENT_HEADERS.WORKSPACE_ID];
    const result = verifyAgentRequest(makeRequest(headers));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("missing_envelope");
  });

  it("rejects missing run_id", () => {
    const headers = envelopeHeaders();
    delete headers[AGENT_HEADERS.RUN_ID];
    const result = verifyAgentRequest(makeRequest(headers));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("missing_envelope");
  });

  it("rejects a non-uuid user_id", () => {
    const result = verifyAgentRequest(
      makeRequest(envelopeHeaders({ [AGENT_HEADERS.USER_ID]: "not-a-uuid" }))
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("invalid_envelope");
  });

  it("rejects a non-uuid branch_id when present", () => {
    const result = verifyAgentRequest(
      makeRequest(envelopeHeaders({ [AGENT_HEADERS.BRANCH_ID]: "nope" }))
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("invalid_envelope");
  });

  it("allows branch_id to be absent (read-only tool calls)", () => {
    const headers = envelopeHeaders();
    delete headers[AGENT_HEADERS.BRANCH_ID];
    const result = verifyAgentRequest(makeRequest(headers));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ctx.branchId).toBeNull();
  });

  it("rejects a too-short run_id", () => {
    const result = verifyAgentRequest(
      makeRequest(envelopeHeaders({ [AGENT_HEADERS.RUN_ID]: "short" }))
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("invalid_envelope");
  });
});
