import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the branch promotion gate service.
 *
 * Invariants:
 *
 *   1. createGate generates a 32-byte (64-hex-char) secret.
 *   2. listActiveGates filters to status='active' and workspace scope.
 *   3. runGates calls each webhook with the correct HMAC signature.
 *   4. runGates returns allPassed=true when every webhook responds
 *      with `{ status: 'pass' }`.
 *   5. runGates returns allPassed=false if any webhook fails, errors,
 *      or times out.
 *   6. Per-gate timeout is enforced via AbortController.
 *   7. HMAC signature is deterministic for the same secret + payload.
 *
 * Mocking strategy: we install a minimal Supabase builder that echoes
 * the gates fixture + an in-memory array of run rows, and replace
 * global fetch with a vi.fn() that can match URL-by-URL.
 */

import {
  createGate,
  generateSecret,
  listActiveGates,
  runGates,
  signBody,
  type BranchPromotionGate,
} from "@/server/services/branch_promotion_gate_service";

const WORKSPACE_ID = "ws-1";
const BRANCH_ID = "branch-1";
const ACTOR_ID = "user-1";

/** Minimal Supabase-alike mock the service uses. */
interface MockState {
  gates: BranchPromotionGate[];
  runs: Array<{
    id: string;
    gate_id: string;
    branch_id: string;
    status: string;
    response_body: string | null;
    duration_ms: number | null;
    created_at: string;
  }>;
}

function makeSupabaseMock(state: MockState) {
  let runAutoId = 0;

  function fromGates() {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    builder.select = () => {
      const s: Record<string, unknown> = {};
      s.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return s;
      };
      s.order = () => s;
      s.maybeSingle = async () => ({ data: state.gates[0] ?? null, error: null });
      s.single = s.maybeSingle;
      s.then = async (resolve: (v: { data: unknown; error: null }) => void) => {
        let rows = state.gates;
        if (filters.workspace_id)
          rows = rows.filter((g) => g.workspace_id === filters.workspace_id);
        if (filters.status) rows = rows.filter((g) => g.status === filters.status);
        resolve({ data: rows, error: null });
      };
      return s;
    };
    builder.insert = (row: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          const gate: BranchPromotionGate = {
            id: `gate-${state.gates.length + 1}`,
            workspace_id: row.workspace_id as string,
            name: row.name as string,
            webhook_url: row.webhook_url as string,
            secret: row.secret as string,
            timeout_seconds: (row.timeout_seconds as number) ?? 10,
            status: (row.status as "active" | "disabled") ?? "active",
            created_by: (row.created_by as string) ?? null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          state.gates.push(gate);
          return { data: gate, error: null };
        },
      }),
    });
    builder.update = (patch: Record<string, unknown>) => {
      const u: Record<string, unknown> = {};
      const f: Record<string, unknown> = {};
      u.eq = (col: string, val: unknown) => {
        f[col] = val;
        return u;
      };
      u.select = () => ({
        single: async () => {
          const g = state.gates.find((g) => g.id === f.id);
          if (g) Object.assign(g, patch);
          return { data: g, error: null };
        },
      });
      u.then = async (r: (v: { error: null }) => void) => {
        const g = state.gates.find((g) => g.id === f.id);
        if (g) Object.assign(g, patch);
        r({ error: null });
      };
      return u;
    };
    return builder;
  }

  function fromRuns() {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    builder.select = () => {
      const s: Record<string, unknown> = {};
      s.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return s;
      };
      s.in = () => s;
      s.order = () => s;
      s.then = async (r: (v: { data: unknown; error: null }) => void) =>
        r({ data: state.runs, error: null });
      return s;
    };
    builder.insert = (row: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          runAutoId += 1;
          const newRow = {
            id: `run-${runAutoId}`,
            gate_id: row.gate_id as string,
            branch_id: row.branch_id as string,
            status: (row.status as string) ?? "pending",
            response_body: null,
            duration_ms: null,
            created_at: new Date().toISOString(),
          };
          state.runs.push(newRow);
          return { data: newRow, error: null };
        },
      }),
    });
    builder.update = (patch: Record<string, unknown>) => {
      const u: Record<string, unknown> = {};
      const f: Record<string, unknown> = {};
      u.eq = (col: string, val: unknown) => {
        f[col] = val;
        return u;
      };
      u.then = async (r: (v: { error: null }) => void) => {
        const row = state.runs.find((x) => x.id === f.id);
        if (row) Object.assign(row, patch);
        r({ error: null });
      };
      return u;
    };
    return builder;
  }

  return {
    from: (table: string) => {
      if (table === "branch_promotion_gates") return fromGates();
      if (table === "branch_promotion_gate_runs") return fromRuns();
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("generateSecret", () => {
  it("returns 64 hex characters (32 bytes)", () => {
    const s = generateSecret();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
  });
  it("returns a unique value each call", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).not.toEqual(b);
  });
});

describe("signBody", () => {
  it("is deterministic for the same input", () => {
    const a = signBody("secret123", "2026-04-17T00:00:00Z", '{"x":1}');
    const b = signBody("secret123", "2026-04-17T00:00:00Z", '{"x":1}');
    expect(a).toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("changes when the body changes", () => {
    const a = signBody("secret123", "2026-04-17T00:00:00Z", '{"x":1}');
    const b = signBody("secret123", "2026-04-17T00:00:00Z", '{"x":2}');
    expect(a).not.toEqual(b);
  });
  it("changes when the timestamp changes", () => {
    const a = signBody("secret123", "2026-04-17T00:00:00Z", '{"x":1}');
    const b = signBody("secret123", "2026-04-17T00:00:01Z", '{"x":1}');
    expect(a).not.toEqual(b);
  });
  it("changes when the secret changes", () => {
    const a = signBody("secret-a", "2026-04-17T00:00:00Z", '{"x":1}');
    const b = signBody("secret-b", "2026-04-17T00:00:00Z", '{"x":1}');
    expect(a).not.toEqual(b);
  });
});

describe("createGate", () => {
  it("generates a unique secret per gate", async () => {
    const state: MockState = { gates: [], runs: [] };
    const s = makeSupabaseMock(state);
    const a = await createGate(s, WORKSPACE_ID, ACTOR_ID, {
      name: "Lint",
      webhookUrl: "https://hooks.example.com/a",
    });
    const b = await createGate(s, WORKSPACE_ID, ACTOR_ID, {
      name: "Tests",
      webhookUrl: "https://hooks.example.com/b",
    });
    expect(a.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(b.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(a.secret).not.toEqual(b.secret);
  });

  it("rejects non-https URLs", async () => {
    const state: MockState = { gates: [], runs: [] };
    const s = makeSupabaseMock(state);
    await expect(
      createGate(s, WORKSPACE_ID, ACTOR_ID, {
        name: "Bad",
        webhookUrl: "http://hooks.example.com",
      })
    ).rejects.toThrow(/https/i);
  });

  it("rejects loopback URLs", async () => {
    const state: MockState = { gates: [], runs: [] };
    const s = makeSupabaseMock(state);
    await expect(
      createGate(s, WORKSPACE_ID, ACTOR_ID, {
        name: "Loopback",
        webhookUrl: "https://localhost/hook",
      })
    ).rejects.toThrow(/loopback/i);
  });

  it("rejects out-of-range timeout", async () => {
    const state: MockState = { gates: [], runs: [] };
    const s = makeSupabaseMock(state);
    await expect(
      createGate(s, WORKSPACE_ID, ACTOR_ID, {
        name: "Slow",
        webhookUrl: "https://hooks.example.com/x",
        timeoutSeconds: 120,
      })
    ).rejects.toThrow(/timeout/i);
  });
});

describe("listActiveGates", () => {
  it("returns only active gates for the workspace", async () => {
    const state: MockState = {
      gates: [
        makeGate({ id: "g1", name: "a", workspace_id: WORKSPACE_ID, status: "active" }),
        makeGate({ id: "g2", name: "b", workspace_id: WORKSPACE_ID, status: "disabled" }),
        makeGate({ id: "g3", name: "c", workspace_id: "other-ws", status: "active" }),
      ],
      runs: [],
    };
    const s = makeSupabaseMock(state);
    const rows = await listActiveGates(s, WORKSPACE_ID);
    expect(rows.map((r) => r.id).sort()).toEqual(["g1"]);
  });
});

describe("runGates", () => {
  it("returns allPassed=true and an empty run list when no gates are configured", async () => {
    const state: MockState = { gates: [], runs: [] };
    const s = makeSupabaseMock(state);
    const res = await runGates(s, WORKSPACE_ID, BRANCH_ID, "branch-x", emptySummary());
    expect(res.allPassed).toBe(true);
    expect(res.runs).toEqual([]);
  });

  it("calls the webhook with the correct signature header", async () => {
    const state: MockState = {
      gates: [
        makeGate({
          id: "g1",
          name: "lint",
          workspace_id: WORKSPACE_ID,
          secret: "abc",
          webhook_url: "https://hooks.example.com/a",
        }),
      ],
      runs: [],
    };
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: "pass" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await runGates(makeSupabaseMock(state), WORKSPACE_ID, BRANCH_ID, "b", emptySummary());
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://hooks.example.com/a");
    const init = call[1];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-ContextStore-Signature"]).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(headers["X-ContextStore-Timestamp"]).toBeTruthy();
    // Signature should match signBody() for this exact payload.
    const body = init.body as string;
    const expected = signBody("abc", headers["X-ContextStore-Timestamp"], body);
    expect(headers["X-ContextStore-Signature"]).toBe(`v1=${expected}`);
    expect(res.allPassed).toBe(true);
  });

  it("returns allPassed=true when every gate passes", async () => {
    const state: MockState = {
      gates: [
        makeGate({ id: "g1", name: "a", workspace_id: WORKSPACE_ID, webhook_url: "https://h/a" }),
        makeGate({ id: "g2", name: "b", workspace_id: WORKSPACE_ID, webhook_url: "https://h/b" }),
      ],
      runs: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ status: "pass" }), { status: 200 })
      )
    );
    const res = await runGates(makeSupabaseMock(state), WORKSPACE_ID, BRANCH_ID, "b", emptySummary());
    expect(res.allPassed).toBe(true);
    expect(res.runs.every((r) => r.status === "passed")).toBe(true);
  });

  it("returns allPassed=false when any gate fails", async () => {
    const state: MockState = {
      gates: [
        makeGate({ id: "g1", name: "a", workspace_id: WORKSPACE_ID, webhook_url: "https://h/a" }),
        makeGate({ id: "g2", name: "b", workspace_id: WORKSPACE_ID, webhook_url: "https://h/b" }),
      ],
      runs: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/a"))
          return new Response(JSON.stringify({ status: "pass" }), { status: 200 });
        return new Response(JSON.stringify({ status: "fail", reason: "tests red" }), {
          status: 200,
        });
      })
    );
    const res = await runGates(makeSupabaseMock(state), WORKSPACE_ID, BRANCH_ID, "b", emptySummary());
    expect(res.allPassed).toBe(false);
    expect(res.runs.filter((r) => r.status === "failed")).toHaveLength(1);
    expect(res.runs.filter((r) => r.status === "passed")).toHaveLength(1);
  });

  it("records a failed run for non-2xx HTTP responses", async () => {
    const state: MockState = {
      gates: [makeGate({ id: "g1", name: "a", workspace_id: WORKSPACE_ID, webhook_url: "https://h/a" })],
      runs: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("internal error", { status: 500 }))
    );
    const res = await runGates(makeSupabaseMock(state), WORKSPACE_ID, BRANCH_ID, "b", emptySummary());
    expect(res.allPassed).toBe(false);
    expect(res.runs[0].status).toBe("failed");
  });

  it("records a timeout when the webhook exceeds its deadline", async () => {
    const state: MockState = {
      gates: [
        makeGate({
          id: "g1",
          name: "slow",
          workspace_id: WORKSPACE_ID,
          webhook_url: "https://h/slow",
          timeout_seconds: 1,
        }),
      ],
      runs: [],
    };
    // Fetch that rejects with AbortError when aborted.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_res, rej) => {
            init.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              rej(err);
            });
          })
      )
    );
    const p = runGates(makeSupabaseMock(state), WORKSPACE_ID, BRANCH_ID, "b", emptySummary());
    // Drive fake timers past the 1s timeout.
    await vi.advanceTimersByTimeAsync(1500);
    const res = await p;
    expect(res.allPassed).toBe(false);
    expect(res.runs[0].status).toBe("timeout");
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGate(overrides: Partial<BranchPromotionGate>): BranchPromotionGate {
  return {
    id: "g?",
    workspace_id: WORKSPACE_ID,
    name: "gate",
    webhook_url: "https://h/x",
    secret: "secret",
    timeout_seconds: 10,
    status: "active",
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function emptySummary() {
  return {
    head_count: 0,
    pending_op_count: 0,
    folder_override_count: 0,
    placement_change_count: 0,
    created_note_link_count: 0,
    created_attachment_count: 0,
    changed_objects: [],
  };
}
