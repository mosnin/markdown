import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Contract tests for Workspace Operator gap #8 — prompt history recall.
//
// Two layers, mirroring the safeNotify pattern:
//
//   1. Pure helpers (pushPromptHistory / loadPromptHistory /
//      savePromptHistory) are exported from operator_panel.tsx and
//      tested directly. Node-safe — no DOM, no React.
//   2. Source-string assertions that the textarea onKeyDown handler
//      actually uses those helpers and gates Up/Down recall correctly
//      (cursor at position 0, textarea empty or already recalling).
// ---------------------------------------------------------------------------

// operator_panel.tsx imports a few server-action modules at the top of
// the file. Stub them so a node-environment import of the panel doesn't
// boot Supabase / Modal / auth context — same pattern as
// operator_panel_action_error_helper.test.ts.
vi.mock("@/server/auth/get_request_context", () => ({
  getRequestContext: vi.fn(() =>
    Promise.resolve({ isAuthenticated: false, user: null, workspace: null })
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
  listOperatorPrompts: vi.fn(),
  createOperatorPrompt: vi.fn(),
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
vi.mock("@/app/app/workspace_operator/quota_actions", () => ({
  loadOperatorQuotaAction: vi.fn(),
}));
vi.mock("@/lib/hooks/use_operator_run", () => ({
  useOperatorProgress: vi.fn(() => []),
}));

import {
  pushPromptHistory,
  loadPromptHistory,
  savePromptHistory,
  PROMPT_HISTORY_MAX,
  PROMPT_HISTORY_KEY_PREFIX,
} from "@/components/product/operator_panel";

// ---------------------------------------------------------------------------
// Layer 1 — pure helpers
// ---------------------------------------------------------------------------

describe("pushPromptHistory — ring buffer semantics", () => {
  it("prepends a new prompt to the most-recent-first list", () => {
    const next = pushPromptHistory(["b", "a"], "c");
    expect(next).toEqual(["c", "b", "a"]);
  });

  it("trims whitespace and rejects empty / whitespace-only prompts", () => {
    expect(pushPromptHistory(["a"], "")).toEqual(["a"]);
    expect(pushPromptHistory(["a"], "   ")).toEqual(["a"]);
    expect(pushPromptHistory([], "  hello  ")).toEqual(["hello"]);
  });

  it("dedupes adjacent duplicates (submitting twice in a row is a no-op)", () => {
    expect(pushPromptHistory(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("re-ranks a non-adjacent duplicate to the head (moves to most-recent)", () => {
    expect(pushPromptHistory(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("caps the buffer at PROMPT_HISTORY_MAX (defaults to 10)", () => {
    expect(PROMPT_HISTORY_MAX).toBe(10);
    const pre = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const next = pushPromptHistory(pre, "new");
    expect(next).toHaveLength(10);
    expect(next[0]).toBe("new");
    // Oldest entry (p9) must have fallen off the tail.
    expect(next).not.toContain("p9");
  });

  it("honours a custom max override", () => {
    const next = pushPromptHistory(["a", "b"], "c", 2);
    expect(next).toEqual(["c", "a"]);
  });
});

// ---------------------------------------------------------------------------
// Layer 1b — localStorage (de)serialization
// ---------------------------------------------------------------------------

function makeStorage(initial?: string): {
  storage: Pick<Storage, "getItem" | "setItem">;
  getBuffer: () => string | undefined;
} {
  let value: string | undefined = initial;
  return {
    storage: {
      getItem: (_k: string) => (value == null ? null : value),
      setItem: (_k: string, v: string) => {
        value = v;
      },
    },
    getBuffer: () => value,
  };
}

describe("loadPromptHistory / savePromptHistory", () => {
  it("round-trips an array of prompts", () => {
    const { storage, getBuffer } = makeStorage();
    savePromptHistory(storage, "key", ["a", "b"]);
    expect(getBuffer()).toBe(JSON.stringify(["a", "b"]));
    expect(loadPromptHistory(storage, "key")).toEqual(["a", "b"]);
  });

  it("returns [] when the key is missing", () => {
    const { storage } = makeStorage();
    expect(loadPromptHistory(storage, "missing")).toEqual([]);
  });

  it("returns [] for malformed JSON (fail-open, history is advisory)", () => {
    const { storage } = makeStorage("not-json{");
    expect(loadPromptHistory(storage, "key")).toEqual([]);
  });

  it("returns [] when the payload isn't an array", () => {
    const { storage } = makeStorage(JSON.stringify({ not: "array" }));
    expect(loadPromptHistory(storage, "key")).toEqual([]);
  });

  it("filters non-string entries (best-effort recovery)", () => {
    const { storage } = makeStorage(JSON.stringify(["a", 42, null, "b"]));
    expect(loadPromptHistory(storage, "key")).toEqual(["a", "b"]);
  });

  it("swallows setItem errors (e.g. quota exceeded) without throwing", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => savePromptHistory(storage, "key", ["a"])).not.toThrow();
  });

  it("exports the documented key prefix", () => {
    expect(PROMPT_HISTORY_KEY_PREFIX).toBe("operator-prompt-history:");
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — source-string wiring: the panel actually uses these helpers
// ---------------------------------------------------------------------------

const PANEL_PATH = resolve(
  __dirname,
  "../../components/product/operator_panel.tsx"
);
const panelSource = readFileSync(PANEL_PATH, "utf8");

describe("operator_panel.tsx — prompt history recall wiring", () => {
  it("loads history from localStorage on open via loadPromptHistory", () => {
    expect(panelSource).toMatch(/loadPromptHistory\s*\(\s*window\.localStorage/);
  });

  it("persists to localStorage on submit via pushPromptHistory + savePromptHistory", () => {
    // The submit path lives in handleGeneratePlan — it must push *before*
    // transitioning to the planning phase so a dispatch failure still
    // leaves the prompt recallable.
    const block = panelSource.match(
      /function\s+handleGeneratePlan\s*\([^)]*\)\s*\{[\s\S]*?\n\s{2}\}/
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/pushPromptHistory\s*\(/);
    expect(block![0]).toMatch(/savePromptHistory\s*\(/);
  });

  it("keys localStorage per workspace (boxId-scoped) with the shared prefix", () => {
    expect(panelSource).toMatch(/PROMPT_HISTORY_KEY_PREFIX/);
    expect(panelSource).toMatch(/\$\{PROMPT_HISTORY_KEY_PREFIX\}\$\{boxId\}/);
  });

  it("Up arrow recall is gated on cursor position 0 AND (empty OR recalling)", () => {
    // Without these guards, Up/Down would break vertical line nav inside
    // a user-typed multi-line prompt. The handler computes `atStart` and
    // `emptyOrRecalling` before intercepting ArrowUp / ArrowDown.
    expect(panelSource).toMatch(
      /selectionStart\s*===\s*0\s*&&\s*target\.selectionEnd\s*===\s*0/
    );
    expect(panelSource).toMatch(/emptyOrRecalling/);
    expect(panelSource).toMatch(/e\.key\s*===\s*"ArrowUp"[\s\S]{0,200}?atStart[\s\S]{0,200}?emptyOrRecalling/);
    expect(panelSource).toMatch(/e\.key\s*===\s*"ArrowDown"[\s\S]{0,200}?atStart[\s\S]{0,200}?emptyOrRecalling/);
  });

  it("Esc while recalling clears the textarea and exits recall mode", () => {
    // The handler checks historyIndex !== -1 (isRecalling) and resets
    // both historyIndex and prompt.
    expect(panelSource).toMatch(/isRecalling/);
    expect(panelSource).toMatch(
      /e\.key\s*===\s*"Escape"[\s\S]{0,200}?setHistoryIndex\s*\(\s*-1\s*\)/
    );
  });

  it("typing into the textarea exits recall mode (historyIndex → -1)", () => {
    // The Textarea's onChange must reset historyIndex so subsequent
    // Up/Down from a user-typed mid-prompt state don't re-enter recall
    // with a stale index.
    const textareaBlock = panelSource.match(
      /<Textarea\b[\s\S]*?\/>/
    );
    expect(textareaBlock).not.toBeNull();
    expect(textareaBlock![0]).toMatch(/setHistoryIndex\s*\(\s*-1\s*\)/);
  });
});
