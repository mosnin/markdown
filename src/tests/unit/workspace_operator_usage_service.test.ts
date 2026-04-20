import { describe, it, expect } from "vitest";

import {
  recordOperatorUsage,
  getWorkspaceUsageForMonth,
  getUserUsageForMonth,
  computeEstimatedCostCents,
  sumOperatorUsage,
  monthKey,
  FALLBACK_MODEL,
  MODEL_PRICING,
  type OperatorUsageRecord,
} from "@/server/services/workspace_operator_usage_service";

// ─── Fake Supabase chain ─────────────────────────────────────────────────────
//
// The service hits three code paths:
//   1. from(table).select(cols).eq(...).eq(...).eq(...).maybeSingle()
//      — the pre-upsert read inside recordOperatorUsage
//   2. from(table).upsert(row, opts).select(cols).single()
//      — the actual write
//   3. from(table).select(cols).eq(...).eq(...)  (awaited directly)
//      — the listing reads
//
// We capture each completed query so individual tests can assert payload +
// filters + upsert options. Mirrors the chained-mock pattern used in
// workspace_operator_runs_service.test.ts.

interface QueryRecord {
  table: string;
  op: "select" | "upsert";
  payload?: Record<string, unknown>;
  upsertOptions?: Record<string, unknown>;
  filters: Array<{ col: string; val: unknown; cmp: "eq" }>;
  // Row returned by maybeSingle (for the pre-upsert read).
  returnedSingleRow?: Record<string, unknown> | null;
}

interface FakeSupabaseOpts {
  /** Row returned to the pre-upsert read. Default: null (no existing row). */
  existingRow?: Record<string, unknown> | null;
  /** Row returned by the upsert's .single(). */
  upsertedRow?: Record<string, unknown>;
  /** Rows returned by awaited list queries. */
  listRows?: Array<Record<string, unknown>>;
}

function makeSupabase(opts: FakeSupabaseOpts = {}) {
  const queries: QueryRecord[] = [];
  let maybeSingleCalls = 0;
  let singleCalls = 0;

  function builder(table: string) {
    const record: QueryRecord = { table, op: "select", filters: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: Record<string, any> = {};

    b.upsert = (
      payload: Record<string, unknown>,
      options?: Record<string, unknown>
    ) => {
      record.op = "upsert";
      record.payload = payload;
      record.upsertOptions = options;
      return b;
    };
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      record.filters.push({ col, val, cmp: "eq" });
      return b;
    };
    b.maybeSingle = async () => {
      maybeSingleCalls += 1;
      record.returnedSingleRow = opts.existingRow ?? null;
      queries.push(record);
      return { data: opts.existingRow ?? null, error: null };
    };
    b.single = async () => {
      singleCalls += 1;
      queries.push(record);
      if (record.op === "upsert") {
        return { data: opts.upsertedRow ?? record.payload, error: null };
      }
      return { data: opts.existingRow ?? null, error: null };
    };
    // Thenable: awaited list queries resolve here.
    b.then = (resolve: (v: unknown) => void) => {
      queries.push(record);
      resolve({ data: opts.listRows ?? [], error: null });
    };
    return b;
  }

  return {
    from: builder,
    queries,
    get maybeSingleCalls() {
      return maybeSingleCalls;
    },
    get singleCalls() {
      return singleCalls;
    },
  };
}

// ─── computeEstimatedCostCents ───────────────────────────────────────────────

describe("computeEstimatedCostCents", () => {
  it("uses the gpt-4.1-mini rate for known small-tier calls", () => {
    // 1_000_000 input tokens at 40c/M = 40 cents exactly.
    expect(computeEstimatedCostCents("gpt-4.1-mini", 1_000_000, 0)).toBe(40);
    // 1_000_000 output tokens at 160c/M = 160 cents exactly.
    expect(computeEstimatedCostCents("gpt-4.1-mini", 0, 1_000_000)).toBe(160);
  });

  it("uses the gpt-4.1 rate for full-tier calls", () => {
    expect(computeEstimatedCostCents("gpt-4.1", 1_000_000, 0)).toBe(200);
    expect(computeEstimatedCostCents("gpt-4.1", 0, 1_000_000)).toBe(800);
    // 500k in + 250k out → 100 + 200 = 300 cents
    expect(computeEstimatedCostCents("gpt-4.1", 500_000, 250_000)).toBe(300);
  });

  it("falls back to gpt-4.1-mini for unknown models", () => {
    const known = computeEstimatedCostCents("gpt-4.1-mini", 2_000, 3_000);
    const unknown = computeEstimatedCostCents("made-up-model", 2_000, 3_000);
    expect(unknown).toBe(known);
    expect(MODEL_PRICING[FALLBACK_MODEL]).toBeDefined();
  });

  it("rounds up so any usage counts as at least one cent", () => {
    // 1 output token at 160c/M = 0.00016 cents → ceil → 1 cent.
    expect(computeEstimatedCostCents("gpt-4.1-mini", 0, 1)).toBe(1);
    // 0 tokens = 0 cents (no fractional ceil on zero).
    expect(computeEstimatedCostCents("gpt-4.1-mini", 0, 0)).toBe(0);
  });

  it("clamps negative or NaN token counts to zero", () => {
    expect(computeEstimatedCostCents("gpt-4.1-mini", -100, -50)).toBe(0);
    expect(computeEstimatedCostCents("gpt-4.1-mini", Number.NaN, 0)).toBe(0);
  });
});

// ─── monthKey ────────────────────────────────────────────────────────────────

describe("monthKey", () => {
  it("formats the first-of-month in UTC as YYYY-MM-01", () => {
    const jan5 = new Date(Date.UTC(2026, 0, 5, 12, 30, 0));
    expect(monthKey(jan5)).toBe("2026-01-01");
    const dec31 = new Date(Date.UTC(2026, 11, 31, 23, 59, 59));
    expect(monthKey(dec31)).toBe("2026-12-01");
  });

  it("handles single-digit months with a leading zero", () => {
    const apr20 = new Date(Date.UTC(2026, 3, 20));
    expect(monthKey(apr20)).toBe("2026-04-01");
  });

  it("uses UTC, not local time, for the month boundary", () => {
    // April 1 00:30 UTC is still March 31 in negative-offset TZs. The
    // month key must reflect UTC regardless.
    const aprilFirstUtc = new Date(Date.UTC(2026, 3, 1, 0, 30, 0));
    expect(monthKey(aprilFirstUtc)).toBe("2026-04-01");
  });
});

// ─── recordOperatorUsage — first call of the month ───────────────────────────

describe("recordOperatorUsage — insert path", () => {
  it("creates a new row when no existing row for (workspace,user,month)", async () => {
    const sb = makeSupabase({
      existingRow: null,
      upsertedRow: {
        workspace_id: "ws-1",
        user_id: "user-1",
        month: monthKey(),
        run_count: 1,
        tool_call_count: 3,
        input_token_count: 500,
        output_token_count: 200,
        estimated_cost_cents: 1, // ceil of a sub-cent value
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const record = await recordOperatorUsage(sb as any, {
      workspaceId: "ws-1",
      userId: "user-1",
      toolCallCount: 3,
      inputTokens: 500,
      outputTokens: 200,
      model: "gpt-4.1-mini",
    });

    expect(record.runCount).toBe(1);
    expect(record.toolCallCount).toBe(3);
    expect(record.workspaceId).toBe("ws-1");
    expect(record.userId).toBe("user-1");

    // First query: pre-upsert maybeSingle read.
    expect(sb.queries[0].op).toBe("select");
    expect(sb.queries[0].filters).toEqual(
      expect.arrayContaining([
        { col: "workspace_id", val: "ws-1", cmp: "eq" },
        { col: "user_id", val: "user-1", cmp: "eq" },
        { col: "month", val: monthKey(), cmp: "eq" },
      ])
    );

    // Second query: the upsert itself.
    const upsertQ = sb.queries[1];
    expect(upsertQ.op).toBe("upsert");
    expect(upsertQ.payload).toMatchObject({
      workspace_id: "ws-1",
      user_id: "user-1",
      month: monthKey(),
      run_count: 1,
      tool_call_count: 3,
      input_token_count: 500,
      output_token_count: 200,
    });
    // Cost estimate is ceil → at least 1 cent when any tokens were used.
    expect(upsertQ.payload?.estimated_cost_cents).toBeGreaterThanOrEqual(1);
    expect(upsertQ.upsertOptions).toEqual({
      onConflict: "workspace_id,user_id,month",
    });
  });

  it("defaults runCount to 1 when not provided", async () => {
    const sb = makeSupabase({
      existingRow: null,
      upsertedRow: {
        workspace_id: "ws-1",
        user_id: "user-1",
        month: monthKey(),
        run_count: 1,
        tool_call_count: 0,
        input_token_count: 0,
        output_token_count: 0,
        estimated_cost_cents: 0,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const record = await recordOperatorUsage(sb as any, {
      workspaceId: "ws-1",
      userId: "user-1",
    });
    expect(record.runCount).toBe(1);
    expect(record.toolCallCount).toBe(0);
    expect(record.estimatedCostCents).toBe(0);
  });
});

// ─── recordOperatorUsage — increment path ────────────────────────────────────

describe("recordOperatorUsage — increment path", () => {
  it("sums existing counters with the new values on subsequent writes", async () => {
    const existing = {
      workspace_id: "ws-1",
      user_id: "user-1",
      month: monthKey(),
      run_count: 2,
      tool_call_count: 5,
      input_token_count: 1_000,
      output_token_count: 500,
      estimated_cost_cents: 3,
    };
    const sb = makeSupabase({
      existingRow: existing,
      upsertedRow: {
        ...existing,
        run_count: 3,
        tool_call_count: 7,
        input_token_count: 1_250,
        output_token_count: 750,
        estimated_cost_cents: 4,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const record = await recordOperatorUsage(sb as any, {
      workspaceId: "ws-1",
      userId: "user-1",
      toolCallCount: 2,
      inputTokens: 250,
      outputTokens: 250,
      model: "gpt-4.1-mini",
    });

    expect(record.runCount).toBe(3);
    expect(record.toolCallCount).toBe(7);

    const upsertQ = sb.queries[1];
    expect(upsertQ.payload).toMatchObject({
      run_count: 3,          // 2 + 1 (default runCount)
      tool_call_count: 7,    // 5 + 2
      input_token_count: 1_250, // 1_000 + 250
      output_token_count: 750,  // 500 + 250
    });
    // Existing + ceil of (250 * 40/1M + 250 * 160/1M) = 3 + ceil(0.05) = 4
    expect(upsertQ.payload?.estimated_cost_cents).toBe(4);
  });
});

// ─── getWorkspaceUsageForMonth ───────────────────────────────────────────────

describe("getWorkspaceUsageForMonth", () => {
  it("fetches the current month's rows for a workspace", async () => {
    const rows = [
      {
        workspace_id: "ws-1",
        user_id: "user-a",
        month: monthKey(),
        run_count: 4,
        tool_call_count: 10,
        input_token_count: 2_000,
        output_token_count: 1_000,
        estimated_cost_cents: 5,
      },
      {
        workspace_id: "ws-1",
        user_id: "user-b",
        month: monthKey(),
        run_count: 1,
        tool_call_count: 2,
        input_token_count: 500,
        output_token_count: 250,
        estimated_cost_cents: 1,
      },
    ];
    const sb = makeSupabase({ listRows: rows });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records = await getWorkspaceUsageForMonth(sb as any, "ws-1");

    expect(records).toHaveLength(2);
    expect(records[0].workspaceId).toBe("ws-1");
    expect(records[0].runCount).toBe(4);

    const q = sb.queries[0];
    expect(q.op).toBe("select");
    expect(q.filters).toEqual(
      expect.arrayContaining([
        { col: "workspace_id", val: "ws-1", cmp: "eq" },
        { col: "month", val: monthKey(), cmp: "eq" },
      ])
    );
  });

  it("uses the caller-provided month key when a Date is passed", async () => {
    const sb = makeSupabase({ listRows: [] });
    const feb2026 = new Date(Date.UTC(2026, 1, 15, 12, 0, 0));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getWorkspaceUsageForMonth(sb as any, "ws-1", feb2026);

    const q = sb.queries[0];
    expect(q.filters).toContainEqual({
      col: "month",
      val: "2026-02-01",
      cmp: "eq",
    });
  });

  it("returns an empty array when no rows match", async () => {
    const sb = makeSupabase({ listRows: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records = await getWorkspaceUsageForMonth(sb as any, "ws-empty");
    expect(records).toEqual([]);
  });
});

// ─── getUserUsageForMonth ────────────────────────────────────────────────────

describe("getUserUsageForMonth", () => {
  it("fetches all per-workspace rows for a user in a month", async () => {
    const rows = [
      {
        workspace_id: "ws-1",
        user_id: "user-1",
        month: monthKey(),
        run_count: 2,
        tool_call_count: 4,
        input_token_count: 100,
        output_token_count: 50,
        estimated_cost_cents: 1,
      },
      {
        workspace_id: "ws-2",
        user_id: "user-1",
        month: monthKey(),
        run_count: 3,
        tool_call_count: 6,
        input_token_count: 200,
        output_token_count: 100,
        estimated_cost_cents: 1,
      },
    ];
    const sb = makeSupabase({ listRows: rows });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records = await getUserUsageForMonth(sb as any, "user-1");

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.workspaceId).sort()).toEqual(["ws-1", "ws-2"]);

    const q = sb.queries[0];
    expect(q.filters).toEqual(
      expect.arrayContaining([
        { col: "user_id", val: "user-1", cmp: "eq" },
        { col: "month", val: monthKey(), cmp: "eq" },
      ])
    );
  });
});

// ─── sumOperatorUsage ────────────────────────────────────────────────────────

describe("sumOperatorUsage", () => {
  it("collapses per-user rows into workspace-wide totals", () => {
    const rows: OperatorUsageRecord[] = [
      {
        workspaceId: "ws-1",
        userId: "user-a",
        month: "2026-04-01",
        runCount: 3,
        toolCallCount: 4,
        inputTokenCount: 100,
        outputTokenCount: 50,
        estimatedCostCents: 2,
      },
      {
        workspaceId: "ws-1",
        userId: "user-b",
        month: "2026-04-01",
        runCount: 2,
        toolCallCount: 1,
        inputTokenCount: 40,
        outputTokenCount: 10,
        estimatedCostCents: 1,
      },
    ];
    const totals = sumOperatorUsage(rows);
    expect(totals.runCount).toBe(5);
    expect(totals.toolCallCount).toBe(5);
    expect(totals.inputTokenCount).toBe(140);
    expect(totals.outputTokenCount).toBe(60);
    expect(totals.estimatedCostCents).toBe(3);
  });

  it("returns a zeroed totals object for an empty input", () => {
    const totals = sumOperatorUsage([]);
    expect(totals).toEqual({
      runCount: 0,
      toolCallCount: 0,
      inputTokenCount: 0,
      outputTokenCount: 0,
      estimatedCostCents: 0,
    });
  });
});
