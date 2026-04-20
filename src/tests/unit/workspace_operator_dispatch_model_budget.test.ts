import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  dispatchOperatorRun,
  dispatchOperatorExecute,
} from "@/server/services/workspace_operator_service";

/**
 * Wave 1 F — `dispatchOperatorRun` and `dispatchOperatorExecute` forward the
 * optional model + per-run token budget into the Modal POST body so the
 * Python operator can honour them.
 *
 * The original `workspace_operator_service.test.ts` covers the baseline
 * dispatch contract; we keep the new assertions in this separate file to
 * comply with the file-ownership rules (existing tests are off-limits).
 */

const enabledEnv = {
  WORKSPACE_OPERATOR_ENABLED: "true",
  WORKSPACE_OPERATOR_URL: "https://modal.test/invoke",
  WORKSPACE_OPERATOR_SHARED_SECRET: "dispatcher-secret-abcdefgh12345",
};

const baseInput = {
  runId: "dispatcher-run-0001",
  userId: "00000000-0000-0000-0000-000000000001",
  workspaceId: "11111111-1111-1111-1111-111111111111",
  branchId: "22222222-2222-2222-2222-222222222222",
  boxId: "33333333-3333-3333-3333-333333333333",
  prompt: "Draft a brief on our Q1 roadmap",
};

const originalEnv = { ...process.env };

function okResponse() {
  return new Response(
    JSON.stringify({
      run_id: baseInput.runId,
      status: "completed",
      notes_created: [],
      tool_calls: 0,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("dispatchOperatorRun — Wave 1 F model + budget plumbing", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, ...enabledEnv };
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("forwards the model field when set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    await dispatchOperatorRun(
      { ...baseInput, model: "gpt-4.1" },
      fetchMock as unknown as typeof fetch
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("gpt-4.1");
  });

  it("forwards max_input_tokens / max_output_tokens when set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    await dispatchOperatorRun(
      { ...baseInput, maxInputTokens: 5000, maxOutputTokens: 1000 },
      fetchMock as unknown as typeof fetch
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.max_input_tokens).toBe(5000);
    expect(body.max_output_tokens).toBe(1000);
  });

  it("omits model + budget keys when they are not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    await dispatchOperatorRun(baseInput, fetchMock as unknown as typeof fetch);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty("model");
    expect(body).not.toHaveProperty("max_input_tokens");
    expect(body).not.toHaveProperty("max_output_tokens");
  });

  it("omits model + budget keys when explicitly null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    await dispatchOperatorRun(
      {
        ...baseInput,
        model: null,
        maxInputTokens: null,
        maxOutputTokens: null,
      },
      fetchMock as unknown as typeof fetch
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty("model");
    expect(body).not.toHaveProperty("max_input_tokens");
    expect(body).not.toHaveProperty("max_output_tokens");
  });
});

describe("dispatchOperatorExecute — Wave 1 F model + budget plumbing", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, ...enabledEnv };
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("forwards the model + budget fields and approved_plan together", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    await dispatchOperatorExecute(
      {
        ...baseInput,
        model: "gpt-4.1-mini",
        maxInputTokens: 2000,
        maxOutputTokens: 800,
        approvedPlan: [{ index: 0, description: "Search", tool: "hybrid_search" }],
      },
      fetchMock as unknown as typeof fetch
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.mode).toBe("execute");
    expect(body.approved_plan).toHaveLength(1);
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.max_input_tokens).toBe(2000);
    expect(body.max_output_tokens).toBe(800);
  });
});
