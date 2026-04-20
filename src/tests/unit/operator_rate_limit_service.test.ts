import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  checkApiRateLimit,
  BURST_LIMIT_PER_MINUTE,
  SUSTAINED_LIMIT_PER_HOUR,
} from "@/server/services/operator_rate_limit_service";

/**
 * Tests for the per-API-key sliding-window rate limiter.
 *
 * Strategy
 * ────────
 * The service touches Supabase via three shapes:
 *   1. `from(table).select("id", { count, head:true }).eq().gt()`  → count
 *   2. `from(table).insert({...})`                                  → record
 *   3. `from(table).select("created_at").eq().gt().order().limit()` → oldest
 *   4. `rpc("prune_operator_api_rate_limit_events", {...})`          → prune
 *
 * The fake below stores rows in-memory keyed by api_key_id and serves
 * each shape from that store. Tests can advance "now" by mutating
 * `nowMs` (we Date.now-stub in beforeEach), so we can exercise the
 * sliding-window aging without sleeping.
 */

// ─── Fake supabase ──────────────────────────────────────────────────────────

interface Row {
  id: string;
  api_key_id: string;
  created_at: string; // ISO
}

interface FakeStore {
  rows: Row[];
  /**
   * Set to true to make the next count call error — proves the
   * fail-open behaviour without us having to wire up a global flag.
   */
  failNextCount?: boolean;
  /** Same idea for inserts — proves the limiter doesn't crash on insert errors. */
  failNextInsert?: boolean;
}

function makeSupabase(store: FakeStore = { rows: [] }) {
  let rowSeq = 0;

  function tableBuilder(table: string) {
    if (table !== "operator_api_rate_limit_events") {
      throw new Error(`unexpected table: ${table}`);
    }

    type Filter = {
      kind: "eq" | "gt";
      col: string;
      val: string;
    };
    const filters: Filter[] = [];
    let isCountQuery = false;
    let isOrderedSelect = false;
    let orderAsc = true;
    let limitN: number | null = null;

    function applyFilters(rows: Row[]): Row[] {
      return rows.filter((r) => {
        for (const f of filters) {
          if (f.kind === "eq" && (r as unknown as Record<string, string>)[f.col] !== f.val) {
            return false;
          }
          if (f.kind === "gt" && (r as unknown as Record<string, string>)[f.col] <= f.val) {
            return false;
          }
        }
        return true;
      });
    }

    // The chain object — each method returns `this` until a thenable
    // terminator (await) collapses it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};

    b.select = (_cols: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.count === "exact" && opts?.head === true) {
        isCountQuery = true;
      }
      return b;
    };
    b.insert = (payload: { api_key_id: string }) => {
      if (store.failNextInsert) {
        store.failNextInsert = false;
        return {
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: null, error: { message: "boom" } }),
        };
      }
      const row: Row = {
        id: `row-${++rowSeq}`,
        api_key_id: payload.api_key_id,
        created_at: new Date(Date.now()).toISOString(),
      };
      store.rows.push(row);
      return {
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: row, error: null }),
      };
    };
    b.eq = (col: string, val: string) => {
      filters.push({ kind: "eq", col, val });
      return b;
    };
    b.gt = (col: string, val: string) => {
      filters.push({ kind: "gt", col, val });
      return b;
    };
    b.order = (_col: string, opts?: { ascending?: boolean }) => {
      isOrderedSelect = true;
      orderAsc = opts?.ascending !== false;
      return b;
    };
    b.limit = (n: number) => {
      limitN = n;
      return b;
    };
    b.then = (resolve: (v: unknown) => void) => {
      if (isCountQuery) {
        if (store.failNextCount) {
          store.failNextCount = false;
          resolve({ count: null, error: { message: "boom" }, data: null });
          return;
        }
        const filtered = applyFilters(store.rows);
        resolve({ count: filtered.length, error: null, data: null });
        return;
      }
      if (isOrderedSelect) {
        const filtered = applyFilters(store.rows).sort((a, b2) =>
          orderAsc
            ? a.created_at.localeCompare(b2.created_at)
            : b2.created_at.localeCompare(a.created_at),
        );
        const sliced = limitN === null ? filtered : filtered.slice(0, limitN);
        resolve({ data: sliced, error: null });
        return;
      }
      // Fallback: plain select
      resolve({ data: applyFilters(store.rows), error: null });
    };

    return b;
  }

  return {
    from: tableBuilder,
    rpc: (name: string, args: { api_key_id_in: string; older_than_seconds: number }) => {
      if (name !== "prune_operator_api_rate_limit_events") {
        throw new Error(`unexpected rpc: ${name}`);
      }
      const cutoff = new Date(Date.now() - args.older_than_seconds * 1000).toISOString();
      const before = store.rows.length;
      store.rows = store.rows.filter(
        (r) => !(r.api_key_id === args.api_key_id_in && r.created_at < cutoff),
      );
      const removed = before - store.rows.length;
      return Promise.resolve({ data: { removed }, error: null });
    },
    _store: store,
  };
}

// ─── Time control ───────────────────────────────────────────────────────────

let nowMs = 0;
beforeEach(() => {
  nowMs = Date.UTC(2026, 3, 20, 12, 0, 0);
  vi.spyOn(Date, "now").mockImplementation(() => nowMs);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function advanceSeconds(s: number) {
  nowMs += s * 1000;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("checkApiRateLimit — burst window", () => {
  it("allows the first request and reports headroom", async () => {
    const fake = makeSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await checkApiRateLimit(fake as any, "k-1");
    expect(out.allowed).toBe(true);
    expect(out.remainingMinute).toBe(BURST_LIMIT_PER_MINUTE - 1);
    expect(out.remainingHour).toBe(SUSTAINED_LIMIT_PER_HOUR - 1);
    expect(fake._store.rows).toHaveLength(1);
  });

  it("allows up to BURST_LIMIT_PER_MINUTE requests, then blocks the next", async () => {
    const fake = makeSupabase();
    for (let i = 0; i < BURST_LIMIT_PER_MINUTE; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await checkApiRateLimit(fake as any, "k-1");
      expect(r.allowed).toBe(true);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocked = await checkApiRateLimit(fake as any, "k-1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(blocked.remainingMinute).toBe(0);
    // The blocked request did NOT insert a row.
    expect(fake._store.rows).toHaveLength(BURST_LIMIT_PER_MINUTE);
  });

  it("allows again after the burst window slides past", async () => {
    const fake = makeSupabase();
    for (let i = 0; i < BURST_LIMIT_PER_MINUTE; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await checkApiRateLimit(fake as any, "k-1");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocked = await checkApiRateLimit(fake as any, "k-1");
    expect(blocked.allowed).toBe(false);

    // Slide past the 60s burst window. The lazy prune (1h) won't remove
    // the rows yet, but the count's `> now() - 60s` filter excludes them.
    advanceSeconds(61);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allowed = await checkApiRateLimit(fake as any, "k-1");
    expect(allowed.allowed).toBe(true);
    // The sustained window (1h) still holds the older rows.
    expect(allowed.remainingHour).toBe(
      SUSTAINED_LIMIT_PER_HOUR - BURST_LIMIT_PER_MINUTE - 1,
    );
  });
});

describe("checkApiRateLimit — sustained window", () => {
  it("enforces the sustained limit independently of the burst limit", async () => {
    const fake = makeSupabase();

    // Pour requests in batches small enough never to trip the burst
    // limit (29 per minute < 30). Walk forward 90s between batches so
    // the burst window always shows at most 29 events.
    const batch = BURST_LIMIT_PER_MINUTE - 1; // 29
    let total = 0;
    while (total + batch <= SUSTAINED_LIMIT_PER_HOUR) {
      for (let i = 0; i < batch; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await checkApiRateLimit(fake as any, "k-2");
        expect(r.allowed).toBe(true);
        total++;
      }
      advanceSeconds(90);
    }
    // Top up to exactly the sustained limit.
    while (total < SUSTAINED_LIMIT_PER_HOUR) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await checkApiRateLimit(fake as any, "k-2");
      expect(r.allowed).toBe(true);
      total++;
    }

    // Next request must be blocked by the sustained limit, not the
    // burst limit (we walked time forward enough that the burst window
    // is well below 30).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocked = await checkApiRateLimit(fake as any, "k-2");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remainingHour).toBe(0);
    // retryAfter for the sustained window can be much larger than 60s.
    expect(blocked.retryAfterSeconds).toBeGreaterThan(60);
  });
});

describe("checkApiRateLimit — pruning", () => {
  it("removes rows older than 1 hour when the lazy prune fires", async () => {
    const fake = makeSupabase();

    // Manually seed an ancient row (2 hours old) and a fresh row.
    const ancient = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    fake._store.rows.push({ id: "old-1", api_key_id: "k-3", created_at: ancient });
    fake._store.rows.push({
      id: "fresh-1",
      api_key_id: "k-3",
      created_at: new Date(Date.now() - 30 * 1000).toISOString(),
    });
    expect(fake._store.rows).toHaveLength(2);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await checkApiRateLimit(fake as any, "k-3");

    // The fire-and-forget prune is async — let it settle.
    await new Promise((r) => setTimeout(r, 0));

    // The ancient row is gone; the fresh row + the just-inserted row remain.
    const remaining = fake._store.rows.filter((r) => r.api_key_id === "k-3");
    expect(remaining.find((r) => r.id === "old-1")).toBeUndefined();
    expect(remaining.find((r) => r.id === "fresh-1")).toBeDefined();
  });
});

describe("checkApiRateLimit — quota interaction", () => {
  it("does NOT call any quota-side effect on a rate-limit denial", async () => {
    // The contract for this test: when the limiter denies, it returns
    // `allowed: false` and (a) does NOT insert a row and (b) does NOT
    // touch any other table. The route layer is what would invoke the
    // quota check next, and we want to prove that doesn't run.
    //
    // We assert (a) and (b) directly here; the route-layer "skip quota
    // when rate-limited" wiring is covered by the route already
    // returning before `checkOperatorQuota` is reached (visible in the
    // edited route file, which sequences rate-limit BEFORE quota).
    const fake = makeSupabase();
    for (let i = 0; i < BURST_LIMIT_PER_MINUTE; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await checkApiRateLimit(fake as any, "k-4");
    }
    const beforeRows = fake._store.rows.length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const denied = await checkApiRateLimit(fake as any, "k-4");
    expect(denied.allowed).toBe(false);
    // No row added on denial.
    expect(fake._store.rows.length).toBe(beforeRows);
    // The fake throws on any unknown table — proves the limiter never
    // reached out to the quota / usage tables either.
  });
});

describe("checkApiRateLimit — fail-open behaviour", () => {
  it("allows when the count query errors (rate limit is a guardrail, not an availability gate)", async () => {
    const fake = makeSupabase({ rows: [], failNextCount: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await checkApiRateLimit(fake as any, "k-5");
    expect(out.allowed).toBe(true);
  });

  it("does not throw when the insert errors", async () => {
    const fake = makeSupabase({ rows: [], failNextInsert: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await checkApiRateLimit(fake as any, "k-6");
    // The decision is still 'allowed' — an insert glitch shouldn't deny
    // a request that already passed the count check.
    expect(out.allowed).toBe(true);
  });
});
