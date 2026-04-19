import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  dispatchOperatorRun,
  assertOperatorEnabled,
} from "@/server/services/workspace_operator_service";
import { AGENT_HEADERS } from "@/app/api/agent/_lib/auth";

const enabledEnv = {
  WORKSPACE_OPERATOR_ENABLED: "true",
  WORKSPACE_OPERATOR_URL: "https://modal.test/invoke",
  WORKSPACE_OPERATOR_SHARED_SECRET: "dispatcher-secret-abcdefgh12345",
};

const runInput = {
  runId: "dispatcher-run-0001",
  userId: "00000000-0000-0000-0000-000000000001",
  workspaceId: "11111111-1111-1111-1111-111111111111",
  branchId: "22222222-2222-2222-2222-222222222222",
  boxId: "33333333-3333-3333-3333-333333333333",
  prompt: "Draft a brief on our Q1 roadmap",
};

const originalEnv = { ...process.env };

describe("dispatchOperatorRun", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, ...enabledEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("throws when the feature flag is off", async () => {
    process.env.WORKSPACE_OPERATOR_ENABLED = "false";
    await expect(() => dispatchOperatorRun(runInput)).rejects.toThrow(
      /Workspace Operator is not enabled/
    );
  });

  it("posts to the configured endpoint with the envelope headers + body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          run_id: runInput.runId,
          status: "completed",
          notes_created: ["note-a", "note-b"],
          tool_calls: 4,
          error: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await dispatchOperatorRun(runInput, fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://modal.test/invoke");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers[AGENT_HEADERS.SECRET]).toBe(enabledEnv.WORKSPACE_OPERATOR_SHARED_SECRET);
    expect(headers[AGENT_HEADERS.USER_ID]).toBe(runInput.userId);
    expect(headers[AGENT_HEADERS.WORKSPACE_ID]).toBe(runInput.workspaceId);
    expect(headers[AGENT_HEADERS.BRANCH_ID]).toBe(runInput.branchId);
    expect(headers[AGENT_HEADERS.RUN_ID]).toBe(runInput.runId);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      run_id: runInput.runId,
      workspace_id: runInput.workspaceId,
      branch_id: runInput.branchId,
      box_id: runInput.boxId,
      prompt: runInput.prompt,
    });

    expect(result).toEqual({
      run_id: runInput.runId,
      status: "completed",
      notes_created: ["note-a", "note-b"],
      tool_calls: 4,
      error: null,
    });
  });

  it("treats any non-'completed' status value as 'failed'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          run_id: runInput.runId,
          status: "error",
          error: "something exploded",
        }),
        { status: 200 }
      )
    );
    const result = await dispatchOperatorRun(runInput, fetchMock as unknown as typeof fetch);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("something exploded");
    expect(result.notes_created).toEqual([]);
    expect(result.tool_calls).toBe(0);
  });

  it("surfaces non-2xx responses as thrown errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("upstream blew up", { status: 502 }));
    await expect(() =>
      dispatchOperatorRun(runInput, fetchMock as unknown as typeof fetch)
    ).rejects.toThrow(/Workspace Operator endpoint returned 502/);
  });

  it("throws on a malformed JSON response missing run_id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ nope: true }), { status: 200 }));
    await expect(() =>
      dispatchOperatorRun(runInput, fetchMock as unknown as typeof fetch)
    ).rejects.toThrow(/Malformed response/);
  });
});

describe("assertOperatorEnabled", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when feature flag is off", () => {
    process.env.WORKSPACE_OPERATOR_ENABLED = "false";
    expect(() => assertOperatorEnabled()).toThrow(/not enabled/);
  });

  it("does not throw when all three env vars are set", () => {
    Object.assign(process.env, enabledEnv);
    expect(() => assertOperatorEnabled()).not.toThrow();
  });
});
