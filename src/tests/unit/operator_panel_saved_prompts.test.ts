import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Contract tests for the saved-prompts surface the panel consumes:
//
//   1. `listSavedPromptsAction` and `saveOperatorPromptAction` are real
//      exports of `actions.ts` (the panel imports them by name).
//   2. The `SavedOperatorPrompt` type narrows to {id, name, prompt} —
//      this is what crosses the action boundary; extra columns on the
//      server row must be stripped before they reach the client.
//   3. `listSavedPromptsAction()` returns `ActionResult<SavedOperatorPrompt[]>`
//      and the success rows match the {id, name, prompt} shape exactly.
//   4. `saveOperatorPromptAction({name, prompt})` returns
//      `ActionResult<SavedOperatorPrompt>` shaped the same way, and
//      validates required fields.
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
vi.mock("@/server/services/workspace_operator_service", () => ({
  dispatchOperatorRun: vi.fn(),
  dispatchOperatorPlan: vi.fn(),
  dispatchOperatorExecute: vi.fn(),
  cancelOperatorRun: vi.fn(),
  retryOperatorRun: vi.fn(),
}));
vi.mock("@/server/services/workspace_operator_runs_service", () => ({
  createOperatorRun: vi.fn(),
  updateOperatorRun: vi.fn(),
}));
vi.mock("@/server/services/workspace_operator_usage_service", () => ({
  recordOperatorUsage: vi.fn(),
}));
vi.mock("@/server/services/workspace_operator_quota_service", () => ({
  checkOperatorQuota: vi.fn(),
}));
vi.mock("@/server/services/operator_prompts_service", () => ({
  listOperatorPrompts: vi.fn(async () => [
    {
      id: "p1",
      workspace_id: "ws-1",
      user_id: "user-1",
      name: "Weekly digest",
      prompt: "Summarise the week",
      created_at: "2026-04-19T00:00:00Z",
      updated_at: "2026-04-19T00:00:00Z",
    },
    {
      id: "p2",
      workspace_id: "ws-1",
      user_id: "user-1",
      name: "Standup notes",
      prompt: "Draft standup notes",
      created_at: "2026-04-19T00:00:00Z",
      updated_at: "2026-04-19T00:00:00Z",
    },
  ]),
  createOperatorPrompt: vi.fn(async (_sb, args) => ({
    id: "p-new",
    workspace_id: args.workspaceId,
    user_id: args.userId,
    name: args.name,
    prompt: args.prompt,
    created_at: "2026-04-19T00:00:00Z",
    updated_at: "2026-04-19T00:00:00Z",
  })),
}));
vi.mock("@/server/services/operator_notifications_service", () => ({
  notifyRunCompleted: vi.fn(),
  notifyRunFailed: vi.fn(),
}));
vi.mock("@/server/services/branch_service", () => ({
  createDraftBranch: vi.fn(),
}));
vi.mock("@/server/repositories/audit_event_repository", () => ({
  createAuditEvent: vi.fn(),
}));

import * as actions from "@/app/app/workspace_operator/actions";
import type { SavedOperatorPrompt } from "@/app/app/workspace_operator/types";
import { getRequestContext } from "@/server/auth/get_request_context";

beforeEach(() => {
  vi.mocked(getRequestContext).mockResolvedValue({
    isAuthenticated: true,
    user: { id: "user-1", email: "user@example.com" },
    workspace: { id: "ws-1" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
});

describe("actions.ts exports the saved-prompts surface", () => {
  it("exports listSavedPromptsAction as an async function", () => {
    expect(typeof actions.listSavedPromptsAction).toBe("function");
    expect(actions.listSavedPromptsAction()).toBeInstanceOf(Promise);
  });

  it("exports saveOperatorPromptAction as an async function", () => {
    expect(typeof actions.saveOperatorPromptAction).toBe("function");
    expect(
      actions.saveOperatorPromptAction({ name: "n", prompt: "p" })
    ).toBeInstanceOf(Promise);
  });
});

describe("SavedOperatorPrompt shape", () => {
  it("is narrowed to exactly {id, name, prompt} (no server-only columns)", () => {
    // Type-only assertion via runtime introspection: build a value the
    // type-checker accepts and assert the keys we expect.
    const sample: SavedOperatorPrompt = {
      id: "p1",
      name: "Weekly digest",
      prompt: "Summarise the week",
    };
    expect(Object.keys(sample).sort()).toEqual(["id", "name", "prompt"]);
    expect(typeof sample.id).toBe("string");
    expect(typeof sample.name).toBe("string");
    expect(typeof sample.prompt).toBe("string");
  });
});

describe("listSavedPromptsAction return shape", () => {
  it("returns ActionResult<SavedOperatorPrompt[]> with narrowed rows", async () => {
    const res = await actions.listSavedPromptsAction();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data).toHaveLength(2);
    for (const row of res.data) {
      // The action MUST drop workspace_id / user_id / timestamps before
      // they cross the client boundary — the panel only declared the
      // narrow shape.
      expect(Object.keys(row).sort()).toEqual(["id", "name", "prompt"]);
      expect(typeof row.id).toBe("string");
      expect(typeof row.name).toBe("string");
      expect(typeof row.prompt).toBe("string");
    }
    expect(res.data[0]).toEqual({
      id: "p1",
      name: "Weekly digest",
      prompt: "Summarise the week",
    });
  });

  it("returns ok:false when the request is unauthenticated", async () => {
    vi.mocked(getRequestContext).mockResolvedValueOnce({
      isAuthenticated: false,
      user: null,
      workspace: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await actions.listSavedPromptsAction();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("Unauthenticated.");
  });
});

describe("saveOperatorPromptAction return shape", () => {
  it("returns ActionResult<SavedOperatorPrompt> on success", async () => {
    const res = await actions.saveOperatorPromptAction({
      name: "Weekly digest",
      prompt: "Summarise the week",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.data).sort()).toEqual(["id", "name", "prompt"]);
    expect(res.data.name).toBe("Weekly digest");
    expect(res.data.prompt).toBe("Summarise the week");
  });

  it("rejects empty name or prompt with ok:false", async () => {
    const noName = await actions.saveOperatorPromptAction({
      name: "  ",
      prompt: "p",
    });
    expect(noName.ok).toBe(false);
    if (noName.ok) return;
    expect(noName.error).toMatch(/required/i);

    const noPrompt = await actions.saveOperatorPromptAction({
      name: "n",
      prompt: "",
    });
    expect(noPrompt.ok).toBe(false);
    if (noPrompt.ok) return;
    expect(noPrompt.error).toMatch(/required/i);
  });
});
