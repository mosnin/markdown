import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Filter plumbing for the Operator run-history UI.
//
// We assert two layers:
//
//   1. listOperatorRuns — the service — forwards the optional
//      {status, fromDate, toDate, search} args to the supabase query
//      builder as .eq/.in/.gte/.lte/.ilike with the right columns.
//   2. listMyOperatorRunsAction — the server action — expands the
//      "running" UI bucket into the underlying status array and
//      drops empty-string filter values before calling the service.
//
// The service test uses a tiny fake supabase that records every filter;
// the action-layer test feeds the same fake supabase through the real
// service (no service-level mock) so we're exercising the full round
// trip from action → service → query builder.
// ---------------------------------------------------------------------------

// ─── Mocks (hoisted) ────────────────────────────────────────────────────────
//
// We mock supabase/server to return a builder we control per-test, and
// getRequestContext to pretend a user is signed in. We do NOT mock
// workspace_operator_runs_service so the action → service → builder path
// is exercised end-to-end.

type QueryRecord = {
  table: string;
  op: "select";
  filters: Array<{
    col: string;
    val: unknown;
    cmp: "eq" | "lt" | "gte" | "lte" | "ilike" | "in";
  }>;
  ordered?: { col: string; ascending: boolean };
  limit?: number;
};

type SupabaseHarness = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  queries: QueryRecord[];
  selectRows: Array<Record<string, unknown>>;
};

// Shared harness — swapped per-test via setSupabaseRows / setSupabaseHarness.
let currentHarness: SupabaseHarness;

function makeHarness(
  selectRows: Array<Record<string, unknown>> = []
): SupabaseHarness {
  const queries: QueryRecord[] = [];
  function builder(table: string) {
    const record: QueryRecord = { table, op: "select", filters: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: Record<string, any> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      record.filters.push({ col, val, cmp: "eq" });
      return b;
    };
    b.lt = (col: string, val: unknown) => {
      record.filters.push({ col, val, cmp: "lt" });
      return b;
    };
    b.gte = (col: string, val: unknown) => {
      record.filters.push({ col, val, cmp: "gte" });
      return b;
    };
    b.lte = (col: string, val: unknown) => {
      record.filters.push({ col, val, cmp: "lte" });
      return b;
    };
    b.ilike = (col: string, val: unknown) => {
      record.filters.push({ col, val, cmp: "ilike" });
      return b;
    };
    b.in = (col: string, val: unknown) => {
      record.filters.push({ col, val, cmp: "in" });
      return b;
    };
    b.order = (col: string, opts: { ascending: boolean }) => {
      record.ordered = { col, ascending: opts.ascending };
      return b;
    };
    b.limit = (n: number) => {
      record.limit = n;
      return b;
    };
    b.then = (resolve: (v: unknown) => void) => {
      queries.push(record);
      resolve({ data: selectRows, error: null });
    };
    return b;
  }
  return { client: { from: builder }, queries, selectRows };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => currentHarness.client),
}));

vi.mock("@/server/auth/get_request_context", () => ({
  getRequestContext: vi.fn(async () => ({
    isAuthenticated: true,
    user: { id: "user-1", email: "user@example.com" },
    workspace: { id: "ws-1" },
  })),
}));

// NOTE: operator_artifacts_service is imported transitively by
// history_actions.ts — we don't use rollback/artifacts here but we need
// the module to load cleanly.
vi.mock("@/server/services/operator_artifacts_service", () => ({
  listRunArtifacts: vi.fn(async () => []),
  rollbackRun: vi.fn(async () => ({
    total: 0,
    rolledBack: 0,
    alreadyDeleted: 0,
    errors: {},
  })),
}));

import {
  listOperatorRuns,
  type OperatorRunStatus,
} from "@/server/services/workspace_operator_runs_service";
import { listMyOperatorRunsAction } from "@/app/app/workspace_operator/history_actions";

beforeEach(() => {
  currentHarness = makeHarness();
});

// ─── Service-layer filter composition ────────────────────────────────────────

describe("listOperatorRuns — filter composition", () => {
  it("applies a single status as .eq('status', ...)", async () => {
    await listOperatorRuns(currentHarness.client, {
      workspaceId: "ws-1",
      userId: "user-1",
      status: "completed",
    });
    const q = currentHarness.queries[0];
    expect(q.filters).toContainEqual({
      col: "status",
      val: "completed",
      cmp: "eq",
    });
    expect(q.filters).toContainEqual({
      col: "workspace_id",
      val: "ws-1",
      cmp: "eq",
    });
    expect(q.filters).toContainEqual({
      col: "user_id",
      val: "user-1",
      cmp: "eq",
    });
  });

  it("applies an array status as .in('status', [...])", async () => {
    const inFlight: OperatorRunStatus[] = [
      "executing",
      "planning",
      "awaiting_approval",
    ];
    await listOperatorRuns(currentHarness.client, {
      userId: "user-1",
      status: inFlight,
    });
    const q = currentHarness.queries[0];
    const inFilter = q.filters.find((f) => f.cmp === "in");
    expect(inFilter).toBeDefined();
    expect(inFilter?.col).toBe("status");
    expect(inFilter?.val).toEqual(inFlight);
  });

  it("skips an empty status array entirely", async () => {
    await listOperatorRuns(currentHarness.client, {
      userId: "user-1",
      status: [],
    });
    const q = currentHarness.queries[0];
    expect(q.filters.find((f) => f.col === "status")).toBeUndefined();
  });

  it("applies fromDate as .gte('created_at', ...) and toDate as .lte", async () => {
    await listOperatorRuns(currentHarness.client, {
      userId: "user-1",
      fromDate: "2026-04-01T00:00:00.000Z",
      toDate: "2026-04-19T23:59:59.999Z",
    });
    const q = currentHarness.queries[0];
    expect(q.filters).toContainEqual({
      col: "created_at",
      val: "2026-04-01T00:00:00.000Z",
      cmp: "gte",
    });
    expect(q.filters).toContainEqual({
      col: "created_at",
      val: "2026-04-19T23:59:59.999Z",
      cmp: "lte",
    });
  });

  it("applies search as .ilike('prompt', '%needle%')", async () => {
    await listOperatorRuns(currentHarness.client, {
      userId: "user-1",
      search: "roadmap",
    });
    const q = currentHarness.queries[0];
    expect(q.filters).toContainEqual({
      col: "prompt",
      val: "%roadmap%",
      cmp: "ilike",
    });
  });

  it("escapes LIKE wildcards in the search term", async () => {
    await listOperatorRuns(currentHarness.client, {
      userId: "user-1",
      search: "100% coverage_plan",
    });
    const q = currentHarness.queries[0];
    const ilike = q.filters.find((f) => f.cmp === "ilike");
    // '%' and '_' are LIKE metacharacters — they must be backslash-escaped
    // so a user searching for '100%' doesn't silently match everything.
    expect(ilike?.val).toBe("%100\\% coverage\\_plan%");
  });

  it("ignores whitespace-only search input", async () => {
    await listOperatorRuns(currentHarness.client, {
      userId: "user-1",
      search: "   ",
    });
    const q = currentHarness.queries[0];
    expect(q.filters.find((f) => f.cmp === "ilike")).toBeUndefined();
  });

  it("composes status + date + search + cursor into a single AND'd query", async () => {
    await listOperatorRuns(currentHarness.client, {
      workspaceId: "ws-1",
      userId: "user-1",
      status: "failed",
      fromDate: "2026-04-01T00:00:00.000Z",
      toDate: "2026-04-19T23:59:59.999Z",
      search: "roadmap",
      cursor: "2026-04-20T00:00:00.000Z",
      limit: 10,
    });
    const q = currentHarness.queries[0];
    expect(q.limit).toBe(10);
    expect(q.ordered).toEqual({ col: "created_at", ascending: false });

    // Every caller-supplied filter should be on the builder.
    const byCol = (col: string, cmp: string) =>
      q.filters.some((f) => f.col === col && f.cmp === cmp);
    expect(byCol("workspace_id", "eq")).toBe(true);
    expect(byCol("user_id", "eq")).toBe(true);
    expect(byCol("status", "eq")).toBe(true);
    expect(byCol("created_at", "gte")).toBe(true);
    expect(byCol("created_at", "lte")).toBe(true);
    expect(byCol("created_at", "lt")).toBe(true); // cursor paging
    expect(byCol("prompt", "ilike")).toBe(true);
  });

  it("preserves cursor-pagination semantics under filters (nextCursor from last row)", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `r-${i}`,
      created_at: `2026-04-1${3 - i}T00:00:00.000Z`,
    }));
    currentHarness = makeHarness(rows);
    const result = await listOperatorRuns(currentHarness.client, {
      userId: "user-1",
      status: "completed",
      limit: 3,
    });
    expect(result.rows).toHaveLength(3);
    expect(result.nextCursor).toBe("2026-04-11T00:00:00.000Z");
  });

  it("emits no filters for status/date/search when they are undefined", async () => {
    await listOperatorRuns(currentHarness.client, { userId: "user-1" });
    const q = currentHarness.queries[0];
    expect(q.filters.find((f) => f.col === "status")).toBeUndefined();
    expect(q.filters.find((f) => f.cmp === "gte")).toBeUndefined();
    expect(q.filters.find((f) => f.cmp === "lte")).toBeUndefined();
    expect(q.filters.find((f) => f.cmp === "ilike")).toBeUndefined();
  });
});

// ─── Action-layer filter bucket expansion ────────────────────────────────────
//
// End-to-end: action → service → fake supabase. We inspect the captured
// query filters to verify the action expanded buckets correctly.

describe("listMyOperatorRunsAction — filter forwarding", () => {
  it("expands the 'running' bucket into executing/planning/awaiting_approval", async () => {
    const res = await listMyOperatorRunsAction({ status: "running" });
    expect(res.ok).toBe(true);
    const q = currentHarness.queries[0];
    const inFilter = q.filters.find((f) => f.col === "status" && f.cmp === "in");
    expect(inFilter?.val).toEqual([
      "executing",
      "planning",
      "awaiting_approval",
    ]);
  });

  it("forwards 'completed' as a single .eq('status','completed')", async () => {
    await listMyOperatorRunsAction({ status: "completed" });
    const q = currentHarness.queries[0];
    expect(q.filters).toContainEqual({
      col: "status",
      val: "completed",
      cmp: "eq",
    });
  });

  it("treats 'all' as no status filter", async () => {
    await listMyOperatorRunsAction({ status: "all" });
    const q = currentHarness.queries[0];
    expect(q.filters.find((f) => f.col === "status")).toBeUndefined();
  });

  it("forwards fromDate → .gte, toDate → .lte, and search → .ilike on prompt", async () => {
    await listMyOperatorRunsAction({
      fromDate: "2026-04-01T00:00:00.000Z",
      toDate: "2026-04-19T23:59:59.999Z",
      search: "roadmap",
    });
    const q = currentHarness.queries[0];
    expect(q.filters).toContainEqual({
      col: "created_at",
      val: "2026-04-01T00:00:00.000Z",
      cmp: "gte",
    });
    expect(q.filters).toContainEqual({
      col: "created_at",
      val: "2026-04-19T23:59:59.999Z",
      cmp: "lte",
    });
    expect(q.filters).toContainEqual({
      col: "prompt",
      val: "%roadmap%",
      cmp: "ilike",
    });
  });

  it("drops whitespace-only filter values before hitting the service", async () => {
    await listMyOperatorRunsAction({
      fromDate: "   ",
      toDate: "",
      search: "  ",
    });
    const q = currentHarness.queries[0];
    expect(q.filters.find((f) => f.cmp === "gte")).toBeUndefined();
    expect(q.filters.find((f) => f.cmp === "lte")).toBeUndefined();
    expect(q.filters.find((f) => f.cmp === "ilike")).toBeUndefined();
  });

  it("forwards the cursor for 'Load more' even when filters are active", async () => {
    await listMyOperatorRunsAction({
      cursor: "2026-04-20T00:00:00.000Z",
      status: "failed",
      search: "oops",
    });
    const q = currentHarness.queries[0];
    expect(q.filters).toContainEqual({
      col: "created_at",
      val: "2026-04-20T00:00:00.000Z",
      cmp: "lt",
    });
    expect(q.filters).toContainEqual({
      col: "status",
      val: "failed",
      cmp: "eq",
    });
    expect(q.filters).toContainEqual({
      col: "prompt",
      val: "%oops%",
      cmp: "ilike",
    });
  });

  it("still scopes to the caller's workspace and user even with filters", async () => {
    await listMyOperatorRunsAction({ status: "completed", search: "x" });
    const q = currentHarness.queries[0];
    expect(q.filters).toContainEqual({
      col: "workspace_id",
      val: "ws-1",
      cmp: "eq",
    });
    expect(q.filters).toContainEqual({
      col: "user_id",
      val: "user-1",
      cmp: "eq",
    });
  });
});
