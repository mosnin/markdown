import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Contract tests for the prompts CRUD server actions in
// src/app/app/workspace_operator/prompts_actions.ts. We mock the
// underlying service plus next/cache so revalidatePath is a no-op, then
// assert each action wires through to the right call with the right
// (workspace, user) scoping.
// ---------------------------------------------------------------------------

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
  createClient: vi.fn(() => Promise.resolve({})),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/server/services/operator_prompts_service", () => ({
  listOperatorPrompts: vi.fn(async () => []),
  createOperatorPrompt: vi.fn(async (_sb, args) => ({
    id: "prompt-1",
    workspace_id: args.workspaceId,
    user_id: args.userId,
    name: args.name,
    prompt: args.prompt,
    created_at: "2026-04-19T00:00:00Z",
    updated_at: "2026-04-19T00:00:00Z",
  })),
  updateOperatorPrompt: vi.fn(async (_sb, id, userId, patch) => ({
    id,
    workspace_id: "ws-1",
    user_id: userId,
    name: patch.name ?? "n",
    prompt: patch.prompt ?? "p",
    created_at: "2026-04-19T00:00:00Z",
    updated_at: "2026-04-19T00:00:01Z",
  })),
  deleteOperatorPrompt: vi.fn(async () => true),
  getOperatorPrompt: vi.fn(async () => null),
}));

import {
  listOperatorPromptsAction,
  createOperatorPromptAction,
  updateOperatorPromptAction,
  deleteOperatorPromptAction,
} from "@/app/app/workspace_operator/prompts_actions";
import {
  listOperatorPrompts,
  createOperatorPrompt,
  updateOperatorPrompt,
  deleteOperatorPrompt,
} from "@/server/services/operator_prompts_service";
import { getRequestContext } from "@/server/auth/get_request_context";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRequestContext).mockResolvedValue({
    isAuthenticated: true,
    user: { id: "user-1" },
    workspace: { id: "ws-1" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
});

describe("listOperatorPromptsAction", () => {
  it("scopes to the (workspace, user) pair from the request context", async () => {
    const res = await listOperatorPromptsAction();
    expect(res.ok).toBe(true);
    expect(listOperatorPrompts).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: "ws-1",
      userId: "user-1",
    });
  });
});

describe("createOperatorPromptAction", () => {
  it("forwards name + prompt to the service and returns the created row", async () => {
    const res = await createOperatorPromptAction({
      name: "Weekly summary",
      prompt: "Summarise the last week of changes",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.name).toBe("Weekly summary");
    expect(createOperatorPrompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "ws-1",
        userId: "user-1",
        name: "Weekly summary",
        prompt: "Summarise the last week of changes",
      })
    );
  });

  it("surfaces service errors as ok:false", async () => {
    vi.mocked(createOperatorPrompt).mockRejectedValueOnce(
      new Error("Prompt body is required")
    );
    const res = await createOperatorPromptAction({ name: "n", prompt: "" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/required/);
  });
});

describe("updateOperatorPromptAction", () => {
  it("passes through id + user id + patch to the service", async () => {
    const res = await updateOperatorPromptAction({
      id: "prompt-9",
      patch: { name: "Renamed" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.name).toBe("Renamed");
    expect(updateOperatorPrompt).toHaveBeenCalledWith(
      expect.anything(),
      "prompt-9",
      "user-1",
      { name: "Renamed" }
    );
  });
});

describe("deleteOperatorPromptAction", () => {
  it("deletes via the service and reports the boolean result", async () => {
    const res = await deleteOperatorPromptAction("prompt-7");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.deleted).toBe(true);
    expect(deleteOperatorPrompt).toHaveBeenCalledWith(
      expect.anything(),
      "prompt-7",
      "user-1"
    );
  });
});
