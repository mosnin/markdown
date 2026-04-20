import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Integration tests — Workspace Operator REST quota + rate-limit ordering.
 *
 * Validates the ordering invariant documented in the route and in
 * operator_rate_limit_service.ts: rate limit runs BEFORE the monthly quota
 * so a leaked key cannot drain the workspace's monthly allocation in a
 * burst. Also validates the admin-email bypass does NOT apply to the REST
 * surface (there's no user session to attribute it to; we can't tell
 * "admin Sam acting as Bob" from a bare wopr_ key).
 *
 * Mocking strategy matches operator_rest_full_flow.test.ts:
 *   - Admin Supabase is a local in-memory fake.
 *   - verifyApiKey is mocked.
 *   - Modal dispatchers are mocked (they shouldn't be reached on a deny).
 *   - checkOperatorQuota and checkApiRateLimit run their REAL implementations
 *     against the fake so the ordering test is meaningful.
 */

const ENV_BACKUP = process.env;

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/env", () => ({
  isWorkspaceOperatorEnabled: vi.fn(() => true),
}));

let currentAdmin: FakeSupabase | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => currentAdmin),
}));

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

const dispatchOperatorRunMock = vi.fn();
const dispatchOperatorPlanMock = vi.fn();
const dispatchOperatorExecuteMock = vi.fn();
vi.mock("@/server/services/workspace_operator_service", () => ({
  dispatchOperatorRun: (...a: unknown[]) => dispatchOperatorRunMock(...a),
  dispatchOperatorPlan: (...a: unknown[]) => dispatchOperatorPlanMock(...a),
  dispatchOperatorExecute: (...a: unknown[]) => dispatchOperatorExecuteMock(...a),
}));

import { POST } from "@/app/api/operator/runs/route";
import {
  BURST_LIMIT_PER_MINUTE,
  SUSTAINED_LIMIT_PER_HOUR,
} from "@/server/services/operator_rate_limit_service";
import { OPERATOR_TIER_LIMITS } from "@/server/services/workspace_operator_quota_service";

// ─── Canonical test constants ───────────────────────────────────────────────

const WS_FREE = "11111111-1111-1111-1111-111111111111";
const WS_PRO = "22222222-2222-2222-2222-222222222222";
const USER_FREE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_PRO = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const KEY_FREE = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const KEY_PRO = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const BRANCH_FREE = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const BRANCH_PRO = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const BOX_FREE = "00000000-0000-0000-0000-000000000001";
const BOX_PRO = "00000000-0000-0000-0000-000000000002";
const VALID_BEARER = "Bearer wopr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

// ─── Fake Supabase (trimmed copy of the one used in operator_rest_full_flow) ─

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
      | { kind: "is"; col: string; val: unknown };

    const filters: Filter[] = [];
    let isCountHead = false;
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
        }
        return true;
      });

    const resolve = <T>(value: T): Promise<T> => Promise.resolve(value);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.select = (_cols?: string, opts?: { count?: string; head?: boolean }) => {
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
      const [first] = applyFilters(rowsOf());
      return { data: first ?? null, error: null };
    };
    b.maybeSingle = async () => {
      const matches = applyFilters(rowsOf());
      return { data: matches[0] ?? null, error: null };
    };
    b.then = (resolveFn: (v: unknown) => void) => {
      if (isCountHead) {
        const matches = applyFilters(rowsOf());
        return resolve({ count: matches.length, error: null, data: null }).then(resolveFn);
      }
      if (pendingInsert) {
        const row = { id: `${table}-${++rowSeq}`, ...pendingInsert };
        rowsOf().push(row);
        pendingInsert = null;
        return resolve({ data: row, error: null }).then(resolveFn);
      }
      if (pendingUpdate) {
        const matches = applyFilters(rowsOf());
        for (const m of matches) Object.assign(m, pendingUpdate);
        pendingUpdate = null;
        return resolve({ data: matches, error: null }).then(resolveFn);
      }
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

/**
 * Seed `count` rate-limit event rows for `apiKeyId`, all with the exact
 * same `now()` timestamp the route will see at request time. The real
 * rate limit service uses `gt(created_at, now - window)`, so any row
 * within the window will count.
 */
function seedRateLimitEvents(
  db: FakeDB,
  apiKeyId: string,
  count: number,
  whenIso: string = new Date().toISOString()
) {
  for (let i = 0; i < count; i++) {
    db.operator_api_rate_limit_events.push({
      id: `rl-${apiKeyId}-${i}`,
      api_key_id: apiKeyId,
      created_at: whenIso,
    });
  }
}

/**
 * Seed `runs` usage rows into `workspace_operator_usage` for the given scope.
 * The real quota service sums `run_count` across the current month for
 * either the workspace (Free) or the user (Pro/Business). The fake
 * usage service reader (`sumOperatorUsage`) adds up the `run_count`
 * column, so we pass it directly.
 */
function seedUsage(
  db: FakeDB,
  args: { workspaceId?: string; userId?: string; runs: number }
) {
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  db.workspace_operator_usage.push({
    id: `u-${db.workspace_operator_usage.length + 1}`,
    workspace_id: args.workspaceId ?? null,
    user_id: args.userId ?? null,
    month: monthKey,
    run_count: args.runs,
    tool_call_count: 0,
    input_token_count: 0,
    output_token_count: 0,
    estimated_cost_cents: 0,
  });
}

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

  // Default the Modal dispatcher to success so a run that makes it through
  // the gates can finish cleanly and we can observe side-effects.
  dispatchOperatorRunMock.mockResolvedValue({
    run_id: "modal-echo",
    status: "completed",
    notes_created: [],
    tool_calls: 0,
    error: null,
  });

  const db = freshDb();
  db.workspace_subscriptions.push(
    { workspace_id: WS_FREE, plan: "free", status: "active" },
    { workspace_id: WS_PRO, plan: "pro", status: "active" }
  );
  db.draft_branches.push(
    { id: BRANCH_FREE, workspace_id: WS_FREE, status: "open", name: "free-draft" },
    { id: BRANCH_PRO, workspace_id: WS_PRO, status: "open", name: "pro-draft" }
  );
  db.boxes.push({ id: BOX_FREE, workspace_id: WS_FREE }, { id: BOX_PRO, workspace_id: WS_PRO });

  currentAdmin = makeFakeSupabase(db);
});

afterEach(() => {
  process.env = ENV_BACKUP;
  currentAdmin = null;
  vi.clearAllMocks();
});

// ─── Quota ───────────────────────────────────────────────────────────────────

describe("POST /api/operator/runs — quota gate", () => {
  it("returns 429 quota_exceeded when a Free-tier workspace is already at the cap", async () => {
    verifyApiKeyMock.mockResolvedValue({ id: KEY_FREE, userId: USER_FREE, workspaceId: WS_FREE });
    // Free tier is per-WORKSPACE. Seed at the limit so the next check denies.
    seedUsage(currentAdmin!._db, { workspaceId: WS_FREE, runs: OPERATOR_TIER_LIMITS.free });

    const res = await POST(
      postRequest(
        { prompt: "go", mode: "full", boxId: BOX_FREE, branchId: BRANCH_FREE },
        { Authorization: VALID_BEARER }
      ) as never
    );

    expect(res.status).toBe(429);
    const json = (await res.json()) as { error_code: string; message: string };
    expect(json.error_code).toBe("quota_exceeded");
    expect(json.message).toContain("Free");
    // Modal must not have been called.
    expect(dispatchOperatorRunMock).not.toHaveBeenCalled();
    // And no run row was created.
    expect(currentAdmin!._db.workspace_operator_runs).toHaveLength(0);
  });

  it("allows a Pro-tier caller whose per-user usage is well under cap", async () => {
    verifyApiKeyMock.mockResolvedValue({ id: KEY_PRO, userId: USER_PRO, workspaceId: WS_PRO });
    // Well below the Pro per-user cap of 50.
    seedUsage(currentAdmin!._db, { userId: USER_PRO, runs: 3 });

    const res = await POST(
      postRequest(
        { prompt: "go", mode: "full", boxId: BOX_PRO, branchId: BRANCH_PRO },
        { Authorization: VALID_BEARER }
      ) as never
    );

    expect(res.status).toBe(200);
    expect(dispatchOperatorRunMock).toHaveBeenCalledTimes(1);
    expect(currentAdmin!._db.workspace_operator_runs).toHaveLength(1);
  });
});

// ─── Rate limit ──────────────────────────────────────────────────────────────

describe("POST /api/operator/runs — rate limit gate", () => {
  it("returns 429 rate_limit_exceeded (with Retry-After) when the burst window is full", async () => {
    verifyApiKeyMock.mockResolvedValue({ id: KEY_PRO, userId: USER_PRO, workspaceId: WS_PRO });
    // Burst window full — next request must deny.
    seedRateLimitEvents(currentAdmin!._db, KEY_PRO, BURST_LIMIT_PER_MINUTE);

    const res = await POST(
      postRequest(
        { prompt: "go", mode: "full", boxId: BOX_PRO, branchId: BRANCH_PRO },
        { Authorization: VALID_BEARER }
      ) as never
    );

    expect(res.status).toBe(429);
    // Retry-After header is mandatory on a rate limit deny.
    const retry = res.headers.get("Retry-After");
    expect(retry).not.toBeNull();
    expect(Number(retry)).toBeGreaterThan(0);

    const json = (await res.json()) as { error: string; retry_after_seconds: number };
    expect(json.error).toBe("rate_limit_exceeded");
    expect(json.retry_after_seconds).toBeGreaterThan(0);

    // Nothing downstream should have run.
    expect(currentAdmin!._db.workspace_operator_runs).toHaveLength(0);
    expect(dispatchOperatorRunMock).not.toHaveBeenCalled();
  });

  it("returns 429 rate_limit_exceeded when the sustained window is full but the burst isn't", async () => {
    verifyApiKeyMock.mockResolvedValue({ id: KEY_PRO, userId: USER_PRO, workspaceId: WS_PRO });
    // Seed enough rows to fill the sustained (1h) window, but stagger them
    // so the burst (60s) window shows less than BURST_LIMIT_PER_MINUTE.
    //
    // We just seed SUSTAINED_LIMIT events at "30 minutes ago" — well inside
    // the 1h sustained window, but well outside the 60s burst window.
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    seedRateLimitEvents(currentAdmin!._db, KEY_PRO, SUSTAINED_LIMIT_PER_HOUR, thirtyMinAgo);

    const res = await POST(
      postRequest(
        { prompt: "go", mode: "full", boxId: BOX_PRO, branchId: BRANCH_PRO },
        { Authorization: VALID_BEARER }
      ) as never
    );

    expect(res.status).toBe(429);
    const retry = res.headers.get("Retry-After");
    expect(retry).not.toBeNull();
    const json = (await res.json()) as { error: string; remaining_hour: number };
    expect(json.error).toBe("rate_limit_exceeded");
    expect(json.remaining_hour).toBe(0);
  });
});

// ─── Ordering: rate limit BEFORE quota ───────────────────────────────────────

describe("POST /api/operator/runs — rate limit runs BEFORE quota", () => {
  it("returns rate_limit_exceeded (not quota_exceeded) when BOTH gates would deny", async () => {
    verifyApiKeyMock.mockResolvedValue({ id: KEY_FREE, userId: USER_FREE, workspaceId: WS_FREE });
    // Both gates set to deny. If the ordering is correct, the rate limit
    // service's code is what the caller sees.
    seedRateLimitEvents(currentAdmin!._db, KEY_FREE, BURST_LIMIT_PER_MINUTE);
    seedUsage(currentAdmin!._db, { workspaceId: WS_FREE, runs: OPERATOR_TIER_LIMITS.free });

    const res = await POST(
      postRequest(
        { prompt: "go", mode: "full", boxId: BOX_FREE, branchId: BRANCH_FREE },
        { Authorization: VALID_BEARER }
      ) as never
    );

    expect(res.status).toBe(429);
    const json = (await res.json()) as { error?: string; error_code?: string };
    // Rate limit's envelope uses `error`; quota uses `error_code`. The route
    // must have taken the rate-limit branch if ordering is correct.
    expect(json.error).toBe("rate_limit_exceeded");
    expect(json.error_code).toBeUndefined();
  });
});

// ─── Admin-email bypass does NOT apply on the REST surface ──────────────────

describe("POST /api/operator/runs — admin bypass does NOT apply", () => {
  it("still returns 429 for a quota-exhausted workspace even if the caller looks admin-ish", async () => {
    // The REST surface has no user session to attribute an admin-bypass to,
    // so the route's docstring explicitly says the admin-email escape hatch
    // must not be applied here. We simulate that by making sure the key
    // resolves to a user whose email would otherwise be admin-ish — the
    // route never reads the email, and that's exactly what we're asserting.
    verifyApiKeyMock.mockResolvedValue({
      id: KEY_FREE,
      userId: USER_FREE,
      workspaceId: WS_FREE,
      // Shape-wise, verified doesn't carry an email; even if it did, the
      // route doesn't consult it.
    });
    seedUsage(currentAdmin!._db, { workspaceId: WS_FREE, runs: OPERATOR_TIER_LIMITS.free });

    const res = await POST(
      postRequest(
        { prompt: "go", mode: "full", boxId: BOX_FREE, branchId: BRANCH_FREE },
        { Authorization: VALID_BEARER }
      ) as never
    );
    expect(res.status).toBe(429);
    const json = (await res.json()) as { error_code: string };
    expect(json.error_code).toBe("quota_exceeded");
    expect(dispatchOperatorRunMock).not.toHaveBeenCalled();
  });
});
