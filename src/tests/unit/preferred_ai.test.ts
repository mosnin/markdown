import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  DEFAULT_PREFERRED_AI,
  PREFERRED_AI_STORAGE_KEY,
  readPreferredAi,
  writePreferredAi,
  type PreferredAi,
} from "@/lib/preferred_ai";

// ---------------------------------------------------------------------------
// Test scaffolding — vitest defaults to a Node environment, so we install a
// minimal `window.localStorage` shim per-test. Tests that exercise the SSR
// branch (`typeof window === "undefined"`) explicitly delete the global.
// ---------------------------------------------------------------------------

interface FakeStorage {
  store: Map<string, string>;
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
  clear: () => void;
  key: (i: number) => string | null;
  readonly length: number;
}

function makeFakeStorage(throwing = false): FakeStorage {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => {
      if (throwing) throw new Error("storage disabled");
      return store.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (throwing) throw new Error("storage disabled");
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    key: () => null,
    get length() {
      return store.size;
    },
  };
}

let originalWindow: typeof globalThis.window | undefined;

beforeEach(() => {
  originalWindow = (globalThis as { window?: typeof globalThis.window }).window;
  const ls = makeFakeStorage();
  // Cast — we're synthesizing a minimal Window for the helper's narrow contract.
  (globalThis as unknown as { window: { localStorage: FakeStorage } }).window =
    { localStorage: ls };
});

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: typeof globalThis.window }).window =
      originalWindow;
  }
  vi.restoreAllMocks();
});

// ─── readPreferredAi ─────────────────────────────────────────────────────────

describe("readPreferredAi", () => {
  it("returns the default when nothing is stored", () => {
    expect(readPreferredAi()).toBe(DEFAULT_PREFERRED_AI);
  });

  it("returns each valid stored value verbatim", () => {
    const ls = (
      globalThis as unknown as { window: { localStorage: FakeStorage } }
    ).window.localStorage;
    const cases: PreferredAi[] = [
      "claude-code",
      "cursor",
      "claude-web",
      "chatgpt",
      "other",
    ];
    for (const value of cases) {
      ls.setItem(PREFERRED_AI_STORAGE_KEY, value);
      expect(readPreferredAi()).toBe(value);
    }
  });

  it("falls back to the default for an invalid stored value", () => {
    const ls = (
      globalThis as unknown as { window: { localStorage: FakeStorage } }
    ).window.localStorage;
    ls.setItem(PREFERRED_AI_STORAGE_KEY, "definitely-not-a-real-ai");
    expect(readPreferredAi()).toBe(DEFAULT_PREFERRED_AI);
  });

  it("returns the default during SSR (no window)", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(readPreferredAi()).toBe(DEFAULT_PREFERRED_AI);
  });

  it("swallows localStorage read errors and returns the default", () => {
    (globalThis as unknown as { window: { localStorage: FakeStorage } }).window =
      { localStorage: makeFakeStorage(true) };
    expect(readPreferredAi()).toBe(DEFAULT_PREFERRED_AI);
  });
});

// ─── writePreferredAi ────────────────────────────────────────────────────────

describe("writePreferredAi", () => {
  it("persists the value so the next read returns it (round-trip)", () => {
    writePreferredAi("cursor");
    expect(readPreferredAi()).toBe("cursor");
    writePreferredAi("chatgpt");
    expect(readPreferredAi()).toBe("chatgpt");
  });

  it("stores under the documented localStorage key", () => {
    writePreferredAi("claude-web");
    const ls = (
      globalThis as unknown as { window: { localStorage: FakeStorage } }
    ).window.localStorage;
    expect(ls.getItem(PREFERRED_AI_STORAGE_KEY)).toBe("claude-web");
  });

  it("ignores invalid values (no write, read still returns default)", () => {
    // @ts-expect-error — exercising the runtime guard for a non-PreferredAi.
    writePreferredAi("hal-9000");
    expect(readPreferredAi()).toBe(DEFAULT_PREFERRED_AI);
  });

  it("no-ops during SSR (no window)", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(() => writePreferredAi("cursor")).not.toThrow();
  });

  it("swallows localStorage write errors", () => {
    (globalThis as unknown as { window: { localStorage: FakeStorage } }).window =
      { localStorage: makeFakeStorage(true) };
    expect(() => writePreferredAi("cursor")).not.toThrow();
  });
});
