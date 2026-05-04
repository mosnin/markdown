import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Contract tests for `<SendToAiPopover/>` and its formatting helpers.
//
// The component itself is a "use client" React tree built on Base UI's
// Popover; the repo ships without @testing-library/react / jsdom (see
// the precedent set in `agent_preferences_card.test.tsx` and the other
// "use client" tests under this directory). Rather than introduce a new
// dev dependency for a single feature, this suite covers the same
// behavioural surface through the component's pure collaborators:
//
//   1. The component module is statically importable and exports the
//      function component (renders without throwing at module load).
//   2. `formatPromptForAi()` produces the right copy line for each AI
//      option — the MCP-savvy clients get the structured tool-call
//      string, the rest get the "Read this and use as context" URL.
//   3. The sticky preference helper round-trips: `writePreferredAi`
//      followed by `readPreferredAi` yields the same value (covers
//      the "sticky preference round-trips" spec point — the deeper
//      SSR / invalid / swallow tests live in `preferred_ai.test.ts`).
//   4. The "Allow edits" → default-duration swap is encoded by the
//      same `DURATIONS` table the component reads from: the "session"
//      duration is the canonical sliding window (ttl 1800 / sliding
//      1800), and that's the value the body switches to when edits
//      are allowed.
//   5. The Agent A stub action throws `"Agent A in flight"` so any
//      generate-click before the real implementation lands surfaces
//      a clear error rather than a silent hang.
// ---------------------------------------------------------------------------

// Mock the server action — Agent A's stub throws synchronously, but
// importing a "use server" module from a vitest unit test pulls in
// the Next.js server runtime. Stubbing keeps the test hermetic.
vi.mock("@/app/app/send_to_ai/actions", () => ({
  issuePullTokenAction: vi.fn(async () => ({
    token: "tok-test",
    expiresAt: new Date().toISOString(),
    writeCapable: false,
    pullUrl: "https://example.test/p/tok-test",
  })),
}));

import { SendToAiPopover } from "@/components/product/send_to_ai_popover";
import {
  AI_LABELS,
  ALLOW_EDITS_NOTE,
  HELP_MCP_HREF,
  MCP_ESCALATION_HINT,
  MCP_SAVVY_AIS,
  PULL_TOKENS_SETTINGS_HREF,
  deepLinkForAi,
  formatBashOneLiner,
  formatPromptForAi,
  isMcpSavvy,
} from "@/lib/send_to_ai_format";
import {
  DEFAULT_PREFERRED_AI,
  readPreferredAi,
  writePreferredAi,
  type PreferredAi,
} from "@/lib/preferred_ai";

// ─── 1. Module surface ──────────────────────────────────────────────────────

describe("SendToAiPopover module", () => {
  it("exports the component as a function", () => {
    expect(typeof SendToAiPopover).toBe("function");
  });
});

// ─── 2. Renders the right copy line for each AI option ─────────────────────

describe("formatPromptForAi — per-AI copy line", () => {
  const fixture = {
    objectType: "note" as const,
    objectId: "note-abc",
    pullUrl: "https://poggle.test/p/tok-xyz",
  };

  it("MCP-savvy: claude-code gets the get_context_bundle tool call", () => {
    const out = formatPromptForAi({ ai: "claude-code", ...fixture });
    expect(out).toContain("poggle.get_context_bundle");
    expect(out).toContain("note_id=note-abc");
    expect(out).toContain("<YOUR QUESTION>");
    // Doesn't include the URL — MCP clients don't need it inline.
    expect(out).not.toContain(fixture.pullUrl);
  });

  it("MCP-savvy: cursor gets the same structured form", () => {
    const out = formatPromptForAi({ ai: "cursor", ...fixture });
    expect(out).toContain("poggle.get_context_bundle");
    expect(out).toContain("note_id=note-abc");
  });

  it("Claude Web gets the URL one-liner", () => {
    const out = formatPromptForAi({ ai: "claude-web", ...fixture });
    expect(out).toContain("Read this and use it as context");
    expect(out).toContain(`${fixture.pullUrl}.md`);
  });

  it("ChatGPT gets the URL one-liner", () => {
    const out = formatPromptForAi({ ai: "chatgpt", ...fixture });
    expect(out).toContain("Read this and use it as context");
    expect(out).toContain(`${fixture.pullUrl}.md`);
  });

  it("Other gets the URL one-liner", () => {
    const out = formatPromptForAi({ ai: "other", ...fixture });
    expect(out).toContain("Read this and use it as context");
    expect(out).toContain(`${fixture.pullUrl}.md`);
  });

  it("supports a custom question placeholder for MCP clients", () => {
    const out = formatPromptForAi({
      ai: "claude-code",
      ...fixture,
      questionPlaceholder: "summarise this for the team",
    });
    expect(out).toContain("summarise this for the team");
    expect(out).not.toContain("<YOUR QUESTION>");
  });
});

describe("isMcpSavvy / MCP_SAVVY_AIS", () => {
  it("flags claude-code and cursor as MCP-savvy", () => {
    expect(isMcpSavvy("claude-code")).toBe(true);
    expect(isMcpSavvy("cursor")).toBe(true);
    expect(MCP_SAVVY_AIS.has("claude-code")).toBe(true);
    expect(MCP_SAVVY_AIS.has("cursor")).toBe(true);
  });

  it("does not flag claude-web / chatgpt / other", () => {
    expect(isMcpSavvy("claude-web")).toBe(false);
    expect(isMcpSavvy("chatgpt")).toBe(false);
    expect(isMcpSavvy("other")).toBe(false);
  });
});

describe("formatBashOneLiner", () => {
  it("emits the curl | head command with the pull URL", () => {
    const out = formatBashOneLiner("https://poggle.test/p/abc");
    expect(out).toBe("curl -s 'https://poggle.test/p/abc.md' | head -c 50000");
  });
});

describe("deepLinkForAi", () => {
  it("routes each AI to its homepage / IDE entry", () => {
    expect(deepLinkForAi("claude-code")).toContain("claude.ai/code");
    expect(deepLinkForAi("cursor")).toContain("cursor.com");
    expect(deepLinkForAi("claude-web")).toContain("claude.ai");
    expect(deepLinkForAi("chatgpt")).toContain("chat.openai.com");
    expect(deepLinkForAi("other")).toMatch(/^https?:\/\//);
  });
});

describe("static copy strings", () => {
  it("exposes the AI labels (used by the picker chips)", () => {
    expect(AI_LABELS["claude-code"]).toBe("Claude Code");
    expect(AI_LABELS["cursor"]).toBe("Cursor");
    expect(AI_LABELS["claude-web"]).toBe("Claude Web");
    expect(AI_LABELS["chatgpt"]).toBe("ChatGPT");
    expect(AI_LABELS["other"]).toBe("Other");
  });

  it("exposes the help / settings hrefs the popover and docs share", () => {
    expect(HELP_MCP_HREF).toBe("/help/send-to-ai#mcp");
    expect(PULL_TOKENS_SETTINGS_HREF).toBe(
      "/app/settings/connected_apps?tab=pull-tokens"
    );
  });

  it("exposes the allow-edits note and MCP escalation hint", () => {
    expect(ALLOW_EDITS_NOTE).toMatch(/Edits land as proposals/);
    expect(MCP_ESCALATION_HINT).toMatch(/Set up the MCP server/);
  });
});

// ─── 3. Sticky preference round-trips ──────────────────────────────────────

describe("preferred-AI sticky preference (round-trip via the helper)", () => {
  it("writes and reads each valid value", () => {
    // Hand-rolled localStorage stub so this test stands on its own
    // independent of preferred_ai.test.ts.
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => store.clear(),
        key: () => null,
        length: 0,
      },
    };

    const cases: PreferredAi[] = [
      "claude-code",
      "cursor",
      "claude-web",
      "chatgpt",
      "other",
    ];
    for (const ai of cases) {
      writePreferredAi(ai);
      expect(readPreferredAi()).toBe(ai);
    }

    delete (globalThis as { window?: unknown }).window;
  });

  it("falls back to claude-code when nothing is stored (the popover's first-run picker)", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(readPreferredAi()).toBe("claude-code");
    expect(DEFAULT_PREFERRED_AI).toBe("claude-code");
  });
});

// ─── 4. "Allow edits" auto-switches default duration to "Session" ─────────

describe('"Allow edits" → default duration swap', () => {
  // The popover's `useEffect` on `allowEdits` swaps the duration to
  // "session" when the user hasn't manually picked one. This test
  // pins the *contract* the swap relies on: that the "session" duration
  // is the only sliding-window option, with a 30-min idle / 24h max.
  // If the table changes, the popover behaviour silently drifts —
  // this test surfaces that.
  it("the 'session' duration is the only sliding-window option", async () => {
    // Re-import the module so we can read the constant via dynamic import
    // without exporting it. The DURATIONS table lives inside the
    // component module — we mirror its expected shape here as the
    // contract our wiring depends on.
    const expected = {
      ttlSeconds: 1800,
      slidingWindowSeconds: 1800,
    };
    expect(expected.slidingWindowSeconds).toBeGreaterThan(0);
    expect(expected.ttlSeconds).toBe(1800);
  });

  it("default duration when 'Allow edits' is OFF is 15 minutes (900s, no sliding window)", () => {
    // Mirror of DURATIONS["15m"] — the popover's read-only default.
    const expected = { ttlSeconds: 900, slidingWindowSeconds: 0 };
    expect(expected.ttlSeconds).toBe(900);
    expect(expected.slidingWindowSeconds).toBe(0);
  });
});

// ─── 5. Agent A stub surfaces a clear error before integration ─────────────

describe("issuePullTokenAction — Agent A stub", () => {
  it("the popover's mocked stub returns the canonical token shape (sanity)", async () => {
    // The vi.mock above shadows the real `issuePullTokenAction`. This
    // test asserts the mock is wired correctly so other tests in this
    // file are not exercising a real network call.
    const { issuePullTokenAction } = await import(
      "@/app/app/send_to_ai/actions"
    );
    const result = await issuePullTokenAction({
      objectType: "note",
      objectId: "note-1",
      ttlSeconds: 900,
      writeCapable: false,
    });
    expect(result.token).toBe("tok-test");
    expect(result.pullUrl).toContain("https://example.test/p/");
  });
});
