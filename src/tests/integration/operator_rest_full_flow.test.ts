import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Integration tests — Workspace Operator REST end-to-end flow.
 *
 * This suite closes the Workspace Operator coverage gap where no existing
 * test stitched the full REST → auth → rate limit → quota → branch resolve
 * → createOperatorRun → Modal dispatch → callback chain together. The unit
 * tests in `operator_runs_route.test.ts` mock each boundary individually;
 * here we drive the whole POST /api/operator/runs handler with realistic
 * canned state and only mock at the Modal boundary (dispatch*) and at the
 * admin Supabase client.
 *
 * Mock strategy:
 *   - `createAdminClient` returns an in-memory fake Supabase that models
 *     the subset of table shapes the route touches (draft_branches, boxes,
 *     workspace_operator_runs, operator_api_rate_limit_events,
 *     workspace_subscriptions, workspace_operator_usage).
 *   - `dispatchOperatorRun` / `dispatchOperatorPlan` / `dispatchOperatorExecute`
 *     are mocked with vi.fn() so nothing reaches out to Modal.
 *   - `verifyApiKey` is mocked so we can swap identities per-test without
 *     having to round-trip a sha256 through the fake.
 *   - We intentionally do NOT mock `checkOperatorQuota` or `checkApiRateLimit`
 *     — the whole point of this suite is to exercise the real implementations
 *     of those services against a canned Supabase.
 */

// ─── Environment ────────────────────────────────────────────────────────────

const ENV_BACKUP = process.env;

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Enable the Operator feature flag for every test in this suite.
vi.mock("@/lib/env", () => ({
  isWorkspaceOperatorEnabled: vi.fn(() => true),
}));

// Admin client is produced by a per-test factory injected into a module-level
// variable so each test can swap in its own fake without a module reload.
let currentAdmin: FakeSupabase | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => currentAdmin),
}));

// verifyApiKey is the only piece of operator_api_keys_service we swap.
const verifyApiKeyMock = vi.fn();
vi.mock("@/server/services/operator_api_keys_service", async () => {
  const real = await vi.importActual<
    typeof import("@/server/services/operator_api_keys_service")
  >("@/server/services/operator_api_keys_service");
  return {
    ...real,
    verifyApiKey: (...args: unknown[]) =>
      verifyApiKeyMock(...(args as Parameters<typeof real.verifyApiKey>)),
  };
});

// Modal boundary — the three dispatchers. We mock only these so the run row
// / update / usage calls still execute against the fake Supabase.
const dispatchOperatorRunMock = vi.fn();
const dispatchOperatorPlanMock = vi.fn();
const dispatchOperatorExecuteMock = vi.fn();
vi.mock("@/server/services/workspace_operator_service", () => ({
  dispatchOperatorRun: (...a: unknown[]) => dispatchOperatorRunMock(...a),
  dispatchOperatorPlan: (...a: unknown[]) => dispatchOperatorPlanMock(...a),
  dispatchOperatorExecute: (...a: unknown[]) => dispatchOperatorExecuteMock(...a),
}));

// ─── Imports under test ─────────────────────────────────────────────────────
// These must come AFTER the vi.mock calls above.

import { POST } from "@/app/api/operator/runs/route";
import { GET } from "@/app/api/operator/runs/[id]/route";

// ─── Canonical test constants ───────────────────────────────────────────────

const WS_A = "11111111-1111-1111-1111-111111111111";
const WS_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const API_KEY_ID_A = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const BRANCH_A = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const BRANCH_B = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const BOX_A = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const RUN_A = "99999999-9999-9999-9999-999999999999";
const RUN_B = "88888888-8888-8888-8888-888888888888";

const VALID_BEARER = "Bearer wopr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

// ─── Minimal fake Supabase ──────────────────────────────────────────────────
//
// Only implements the exact chain shapes the route (and the quota / rate
// limit services) invoke. Any unexpected table reaches the generic fallback
// and returns { data: null, error: null } — that matches Supabase's
// maybeSingle() semantics for "no rows".

interface FakeDB {
  draft_branches: Array<{ id: string; workspace_id: string; status: string; name?: string }>;
  boxes: Array<{ id: string; workspace_id: string }>;
  workspace_operator_runs: Array<Record<string, unknown>>;
  workspace_subscriptions: Array<{
    workspace_id: string;
    plan: "free" | "pro" | "business";
    status: "active" | "cancelled" | "past_due";
    override_operator_quota?: boolean;
  }>;
  workspace_operator_usage: Array<Record<string, unknown>>;
  operator_api_rate_limit_events: Array<{ id: string; api_key_id: string; created_at: string }>;
}

type FakeSupabase = ReturnType<typeof makeFakeSupabase>;

function makeFakeSupabase(db: FakeDB) {
  let rowSeq = 0;

  function tableBuilder(table: keyof FakeDB | string) {
    type Filter =
      | { kind: "eq"; col: string; val: unknown }
      | { kind: "gt"; col: string; val: string }
      | { kind: "lt"; col: string; val: string }
      | { kind: "is"; col: string; val: unknown }
      | { kind: "in"; col: string; val: unknown[] };

    const filters: Filter[] = [];
    let isCountHead = false;
    let selectedCols: string | null = null;
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;
    let pendingInsert: Record<string, unknown> | null = null;
    let pendingUpdate: Record<string, unknown> | null = null;

    const rowsOf = (): Record<string, unknown>[] => {
      const raw = (db as unknown as Record<string, Record<string, unknown>[]>)[table];
      return raw ?? [];
    };

    const applyFilters = (
      rows: Record<string, unknown>[]
    ): Record<string, unknown>[] =>
      rows.filter((r) => {
        for (const f of filters) {
          const v = r[f.col];
          if (f.kind === "eq" && v !== f.val) return false;
          if (f.kind === "gt" && !(typeof v === "string" && v > (f.val as string))) return false;
          if (f.kind === "lt" && !(typeof v === "string" && v < (f.val as string))) return false;
          if (f.kind === "is" && v !== f.val) return false;
          if (f.kind === "in" && !(f.val as unknown[]).includes(v)) return false;
        }
        return true;
      });

    const resolve = <T>(value: T): Promise<T> => Promise.resolve(value);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};

    b.select = (cols?: string, opts?: { count?: string; head?: boolean }) => {
      if (cols) selectedCols = cols;
      if (opts?.count === "exact" && opts?.head === true) isCountHead = true;
      return b;
    };
    b.eq = (col: string, val: unknown) => {
      filters.push({ kind: "eq", col, val });
      return b;
    };
    b.gt = (col: string, val: string) => {
      filters.push({ kind: "gt", col, val });
      return b;
    };
    b.lt = (col: string, val: string) => {
      filters.push({ kind: "lt", col, val });
      return b;
    };
    b.is = (col: string, val: unknown) => {
      filters.push({ kind: "is", col, val });
      return b;
    };
    b.in = (col: string, val: unknown[]) => {
      filters.push({ kind: "in", col, val });
      return b;
    };
    b.order = (col: string, opts?: { ascending?: boolean }) => {
      orderBy = { col, asc: opts?.ascending !== false };
      return b;
    };
    b.limit = (n: number) => {
      limitN = n;
      return b;
    };

    b.insert = (payload: Record<string, unknown>) => {
      pendingInsert = payload;
      // Supabase's insert() is itself thenable in the "fire and forget"
      // shape: `await supabase.from().insert({...})` returns {error}.
      // It also supports `.select().single()` to fetch the inserted row.
      // We lazily apply the insert when the terminator runs.
      return b;
    };
    b.update = (payload: Record<string, unknown>) => {
      pendingUpdate = payload;
      return b;
    };
    b.single = async () => {
      if (pendingInsert) {
        const row = { id: `${table}-${++rowSeq}`, ...pendingInsert };
        rowsOf().push(row);
        pendingInsert = null;
        return { data: row, error: null };
      }
      if (pendingUpdate) {
        const matches = applyFilters(rowsOf());
        for (const m of matches) Object.assign(m, pendingUpdate);
        pendingUpdate = null;
        return { data: matches[0] ?? null, error: null };
      }
      const [first] = applyFilters(rowsOf());
      return { data: first ?? null, error: null };
    };
    b.maybeSingle = async () => {
      if (pendingInsert) {
        const row = { id: `${table}-${++rowSeq}`, ...pendingInsert };
        rowsOf().push(row);
        pendingInsert = null;
        return { data: row, error: null };
      }
      const matches = applyFilters(rowsOf());
      return { data: matches[0] ?? null, error: null };
    };

    // Thenable terminator — triggered by `await` on the builder itself.
    b.then = (resolveFn: (v: unknown) => void, _rejectFn?: (e: unknown) => void) => {
      // Count-head queries used by the rate limit service.
      if (isCountHead) {
        const matches = applyFilters(rowsOf());
        return resolve({ count: matches.length, error: null, data: null }).then(resolveFn);
      }
      // Insert terminator — no .select() follow-up, just { error }.
      if (pendingInsert) {
        const row = { id: `${table}-${++rowSeq}`, ...pendingInsert };
        rowsOf().push(row);
        pendingInsert = null;
        return resolve({ data: row, error: null }).then(resolveFn);
      }
      // Update terminator — used in best-effort last_used_at stamp.
      if (pendingUpdate) {
        const matches = applyFilters(rowsOf());
        for (const m of matches) Object.assign(m, pendingUpdate);
        pendingUpdate = null;
        return resolve({ data: matches, error: null }).then(resolveFn);
      }
      // Ordered select (used for oldest-event lookup on rate limit denial).
      let rows = applyFilters(rowsOf());
      if (orderBy) {
        const o = orderBy;
        rows = [...rows].sort((a, c) =>
          o.asc
            ? String(a[o.col]).localeCompare(String(c[o.col]))
            : String(c[o.col]).localeCompare(String(a[o.col]))
        );
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      return resolve({ data: rows, error: null }).then(resolveFn);
    };

    return b;
  }

  return {
    from: tableBuilder,
    rpc: (name: string) => {
      // The rate limit service uses `prune_operator_api_rate_limit_events`.
      // Return a benign empty result so the lazy prune never throws.
      if (name === "prune_operator_api_rate_limit_events") {
        return Promise.resolve({ data: { removed: 0 }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    },
    _db: db,
  };
}

function freshDb(): FakeDB {
  return {
    draft_branches: [],
    boxes: [],
    workspace_operator_runs: [],
    workspace_subscriptions: [],
    workspace_operator_usage: [],
    operator_api_rate_limit_events: [],
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://test/api/operator/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function getRequest(id: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://test/api/operator/runs/${id}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const DUMMY_CTX = { params: Promise.resolve({}) } as never;

// ─── Suite setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env = { ...ENV_BACKUP };
  process.env.WORKSPACE_OPERATOR_ENABLED = "true";
  process.env.WORKSPACE_OPERATOR_URL = "https://modal.local/op";
  process.env.WORKSPACE_OPERATOR_SHARED_SECRET = "s3cr3t";

  verifyApiKeyMock.mockReset();
  dispatchOperatorRunMock.mockReset();
  dispatchOperatorPlanMock.mockReset();
  dispatchOperatorExecuteMock.mockReset();

  // Default identity used by every "happy path" test unless overridden.
  verifyApiKeyMock.mockResolvedValue({
    id: API_KEY_ID_A,
    userId: USER_A,
    workspaceId: WS_A,
  });

  // Seed a usable workspace: pro tier (high quota) + 1 open branch + 1 box.
  const db = freshDb();
  db.workspace_subscriptions.push({ workspace_id: WS_A, plan: "pro", status: "active" });
  db.draft_branches.push({
    id: BRANCH_A,
    workspace_id: WS_A,
    status: "open",
    name: "main-draft",
  });
  // A cross-workspace branch that must not be accessible to WS_A callers.
  db.draft_branches.push({
    id: BRANCH_B,
    workspace_id: WS_B,
    status: "open",
    name: "other-ws-draft",
  });
  db.boxes.push({ id: BOX_A, workspace_id: WS_A });

  currentAdmin = makeFakeSupabase(db);
});

afterEach(() => {
  process.env = ENV_BACKUP;
  currentAdmin = null;
  vi.clearAllMocks();
});

// ─── Golden path: full mode ─────────────────────────────────────────────────

describe("POST /api/operator/runs — full mode golden path", () => {
  it("runs auth → rate limit → quota → branch resolve → createOperatorRun → Modal dispatch → 200", async () => {
    dispatchOperatorRunMock.mockResolvedValueOnce({
      run_id: "modal-echo",
      status: "completed",
      notes_created: ["n-1", "n-2"],
      tool_calls: 4,
      error: null,
      input_tokens: 1200,
      output_tokens: 800,
      model: "gpt-4.1-mini",
    });

    const res = await POST(
      postRequest(
        { prompt: "Summarise Q1 wins", mode: "full", boxId: BOX_A, branchId: BRANCH_A },
        { Authorization: VALID_BEARER }
      ) as never,
      DUMMY_CTX
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { run_id: string; status: string; branch_id: string; notes_created: string[] };
    };
    expect(json.data.status).toBe("completed");
    expect(json.data.branch_id).toBe(BRANCH_A);
    expect(json.data.notes_created).toEqual(["n-1", "n-2"]);

    // The run row was persisted, then transitioned to completed.
    const runs = currentAdmin!._db.workspace_operator_runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.workspace_id).toBe(WS_A);
    expect(runs[0]!.user_id).toBe(USER_A);
    expect(runs[0]!.status).toBe("completed");

    // Modal boundary was invoked exactly once with the correct envelope.
    expect(dispatchOperatorRunMock).toHaveBeenCalledTimes(1);
    const [dispatchArg] = dispatchOperatorRunMock.mock.calls[0]!;
    expect(dispatchArg.workspaceId).toBe(WS_A);
    expect(dispatchArg.userId).toBe(USER_A);
    expect(dispatchArg.branchId).toBe(BRANCH_A);
    expect(dispatchArg.boxId).toBe(BOX_A);

    // Rate limit left an event row behind (proves that service ran).
    expect(
      currentAdmin!._db.operator_api_rate_limit_events.some(
        (r) => r.api_key_id === API_KEY_ID_A
      )
    ).toBe(true);
  });
});

// ─── Plan mode ──────────────────────────────────────────────────────────────

describe("POST /api/operator/runs — plan mode", () => {
  it("returns 202 with awaiting_approval and leaves the run row in that state", async () => {
    dispatchOperatorPlanMock.mockResolvedValueOnce({
      run_id: "modal-plan-echo",
      steps: [{ index: 0, description: "draft intro note", tool: "note.create" }],
      summary: "One step plan",
    });

    const res = await POST(
      postRequest(
        { prompt: "Plan Q1 wins", mode: "plan", boxId: BOX_A, branchId: BRANCH_A },
        { Authorization: VALID_BEARER }
      ) as never,
      DUMMY_CTX
    );

    expect(res.status).toBe(202);
    const json = (await res.json()) as {
      data: { run_id: string; status: string; branch_id: string };
    };
    expect(json.data.status).toBe("awaiting_approval");
    expect(json.data.branch_id).toBe(BRANCH_A);

    const runs = currentAdmin!._db.workspace_operator_runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("awaiting_approval");
    expect(runs[0]!.mode).toBe("plan");

    // Only the plan dispatcher was invoked.
    expect(dispatchOperatorPlanMock).toHaveBeenCalledTimes(1);
    expect(dispatchOperatorRunMock).not.toHaveBeenCalled();
    expect(dispatchOperatorExecuteMock).not.toHaveBeenCalled();
  });
});

// ─── Execute mode ───────────────────────────────────────────────────────────

describe("POST /api/operator/runs — execute mode", () => {
  it("dispatches via dispatchOperatorExecute and returns the run result", async () => {
    dispatchOperatorExecuteMock.mockResolvedValueOnce({
      run_id: "modal-execute-echo",
      status: "completed",
      notes_created: ["n-7"],
      tool_calls: 2,
      error: null,
    });

    const res = await POST(
      postRequest(
        { prompt: "Execute the approved plan", mode: "execute", boxId: BOX_A, branchId: BRANCH_A },
        { Authorization: VALID_BEARER }
      ) as never,
      DUMMY_CTX
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { run_id: string; status: string; notes_created: string[] };
    };
    expect(json.data.status).toBe("completed");
    expect(json.data.notes_created).toEqual(["n-7"]);

    expect(dispatchOperatorExecuteMock).toHaveBeenCalledTimes(1);
    expect(dispatchOperatorRunMock).not.toHaveBeenCalled();
    const [execArg] = dispatchOperatorExecuteMock.mock.calls[0]!;
    // REST execute carries an empty approvedPlan today (see route docstring).
    expect(execArg.approvedPlan).toEqual([]);
    expect(execArg.workspaceId).toBe(WS_A);
  });
});

// ─── Cross-workspace branch rejection ───────────────────────────────────────

describe("POST /api/operator/runs — cross-workspace branchId", () => {
  it("returns 400 with the 'does not belong to this workspace' message", async () => {
    const res = await POST(
      postRequest(
        { prompt: "x", mode: "full", boxId: BOX_A, branchId: BRANCH_B },
        { Authorization: VALID_BEARER }
      ) as never,
      DUMMY_CTX
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as { message: string };
    expect(json.message).toContain("branchId does not belong to this workspace");

    // No run row was created, no Modal dispatch attempted.
    expect(currentAdmin!._db.workspace_operator_runs).toHaveLength(0);
    expect(dispatchOperatorRunMock).not.toHaveBeenCalled();
  });
});

// ─── GET /api/operator/runs/[id] — malformed id ─────────────────────────────

describe("GET /api/operator/runs/[id] — malformed uuid", () => {
  it("returns 404 without touching the DB when the id is not a uuid", async () => {
    const badId = "not-a-uuid";
    const res = await GET(
      getRequest(badId, { Authorization: VALID_BEARER }) as never,
      makeParams(badId)
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error_code: string };
    expect(json.error_code).toBe("not_found");
  });
});

// ─── GET /api/operator/runs/[id] — cross-workspace ─────────────────────────

describe("GET /api/operator/runs/[id] — cross-workspace run", () => {
  it("returns 404 (not 403) when the run exists but belongs to a different workspace", async () => {
    // Seed a run that belongs to WS_B; the caller's key is scoped to WS_A.
    currentAdmin!._db.workspace_operator_runs.push({
      id: RUN_B,
      workspace_id: WS_B,
      user_id: "some-other-user",
      branch_id: null,
      prompt: "not your run",
      mode: "full",
      status: "completed",
      plan: null,
      result: null,
      error: null,
      notes_created: [],
      tool_calls: 0,
      duration_ms: null,
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 0,
      model: null,
      created_at: "2026-04-20T00:00:00Z",
      updated_at: "2026-04-20T00:00:00Z",
    });

    const res = await GET(
      getRequest(RUN_B, { Authorization: VALID_BEARER }) as never,
      makeParams(RUN_B)
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error_code: string; message: string };
    // Info-disclosure defence: must NOT be 403 and must NOT reveal that the
    // run exists in some other workspace.
    expect(json.error_code).toBe("not_found");
    expect(json.message).not.toContain("different workspace");
  });

  it("returns 200 when the run belongs to the caller's workspace", async () => {
    currentAdmin!._db.workspace_operator_runs.push({
      id: RUN_A,
      workspace_id: WS_A,
      user_id: USER_A,
      branch_id: BRANCH_A,
      prompt: "my run",
      mode: "full",
      status: "completed",
      plan: null,
      result: null,
      error: null,
      notes_created: [],
      tool_calls: 0,
      duration_ms: null,
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 0,
      model: null,
      created_at: "2026-04-20T00:00:00Z",
      updated_at: "2026-04-20T00:00:00Z",
    });

    const res = await GET(
      getRequest(RUN_A, { Authorization: VALID_BEARER }) as never,
      makeParams(RUN_A)
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { run_id: string; workspace_id: string } };
    expect(json.data.run_id).toBe(RUN_A);
    expect(json.data.workspace_id).toBe(WS_A);
  });
});
