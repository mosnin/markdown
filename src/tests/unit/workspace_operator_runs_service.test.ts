import { describe, it, expect } from "vitest";

import {
  createOperatorRun,
  updateOperatorRun,
  listOperatorRuns,
  getOperatorRun,
  type WorkspaceOperatorRunRow,
} from "@/server/services/workspace_operator_runs_service";

// ─── Fake Supabase chain ─────────────────────────────────────────────────────
//
// Mirrors the shape the production service calls:
//   from(table).insert(payload).select("*").single()
//   from(table).update(payload).eq(...).select("*").single()
//   from(table).select("*").eq("id", id).maybeSingle()
//   from(table).select("*").order(...).limit(...).eq(...).lt(...)
//
// We capture the last query so individual tests can assert payload + filters.

interface QueryRecord {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: Record<string, unknown>;
  filters: Array<{ col: string; val: unknown; cmp: "eq" | "lt" }>;
  ordered?: { col: string; ascending: boolean };
  limit?: number;
}

interface FakeSupabaseOpts {
  insertedRow?: Record<string, unknown>;
  updatedRow?: Record<string, unknown>;
  singleRow?: Record<string, unknown> | null;
  selectRows?: Array<Record<string, unknown>>;
}

function makeSupabase(opts: FakeSupabaseOpts) {
  const queries: QueryRecord[] = [];

  function builder(table: string) {
    const record: QueryRecord = { table, op: "select", filters: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: Record<string, any> = {};

    b.insert = (payload: Record<string, unknown>) => {
      record.op = "insert";
      record.payload = payload;
      return b;
    };
    b.update = (payload: Record<string, unknown>) => {
      record.op = "update";
      record.payload = payload;
      return b;
    };
    b.upsert = (payload: Record<string, unknown>) => {
      record.op = "insert";
      record.payload = payload;
      return b;
    };
    b.delete = () => {
      record.op = "delete";
      return b;
    };
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      record.filters.push({ col, val, cmp: "eq" });
      return b;
    };
    b.lt = (col: string, val: unknown) => {
      record.filters.push({ col, val, cmp: "lt" });
      return b;
    };
    b.order = (col: string, opts2: { ascending: boolean }) => {
      record.ordered = { col, ascending: opts2.ascending };
      return b;
    };
    b.limit = (n: number) => {
      record.limit = n;
      // listOperatorRuns awaits the chain directly (no .then()-as-thenable
      // is needed because we make the builder itself a thenable below).
      return b;
    };
    b.single = async () => {
      queries.push(record);
      if (record.op === "insert") {
        return { data: opts.insertedRow ?? record.payload, error: null };
      }
      if (record.op === "update") {
        return { data: opts.updatedRow ?? record.payload, error: null };
      }
      return { data: opts.singleRow ?? null, error: null };
    };
    b.maybeSingle = async () => {
      queries.push(record);
      return { data: opts.singleRow ?? null, error: null };
    };
    // Make the builder itself a thenable so `await query` returns rows for
    // the listOperatorRuns query chain (no .single() / .maybeSingle()).
    b.then = (resolve: (v: unknown) => void) => {
      queries.push(record);
      resolve({ data: opts.selectRows ?? [], error: null });
    };
    return b;
  }

  return { from: builder, queries };
}

// ─── createOperatorRun ───────────────────────────────────────────────────────

describe("createOperatorRun", () => {
  it("inserts a queued run and returns the row", async () => {
    const inserted = {
      id: "run-1",
      workspace_id: "ws-1",
      user_id: "user-1",
      branch_id: null,
      prompt: "Draft a brief on Q1 roadmap",
      mode: "plan",
      status: "queued",
      plan: null,
      result: null,
      error: null,
      notes_created: [],
      tool_calls: 0,
      duration_ms: null,
      created_at: "2026-04-19T00:00:00Z",
      updated_at: "2026-04-19T00:00:00Z",
    };
    const sb = makeSupabase({ insertedRow: inserted });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await createOperatorRun(sb as any, {
      workspaceId: "ws-1",
      userId: "user-1",
      prompt: "Draft a brief on Q1 roadmap",
      mode: "plan",
    });

    expect(row.id).toBe("run-1");
    expect(row.status).toBe("queued");
    expect(sb.queries[0].table).toBe("workspace_operator_runs");
    expect(sb.queries[0].op).toBe("insert");
    expect(sb.queries[0].payload).toMatchObject({
      workspace_id: "ws-1",
      user_id: "user-1",
      mode: "plan",
      status: "queued",
      branch_id: null,
    });
  });

  it("trims the prompt and rejects empty prompts", async () => {
    const sb = makeSupabase({ insertedRow: { id: "x" } });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createOperatorRun(sb as any, {
        workspaceId: "ws-1",
        userId: "user-1",
        prompt: "   ",
        mode: "full",
      })
    ).rejects.toThrow(/Prompt is required/);
  });
});

// ─── updateOperatorRun ───────────────────────────────────────────────────────

describe("updateOperatorRun", () => {
  it("only writes the fields named in the patch", async () => {
    const updated = {
      id: "run-1",
      status: "executing",
      tool_calls: 5,
    };
    const sb = makeSupabase({ updatedRow: updated });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await updateOperatorRun(sb as any, "run-1", {
      status: "executing",
      toolCalls: 5,
    });

    expect(row.status).toBe("executing");
    expect(sb.queries[0].op).toBe("update");
    expect(sb.queries[0].payload).toEqual({
      status: "executing",
      tool_calls: 5,
    });
    expect(sb.queries[0].filters).toContainEqual({
      col: "id",
      val: "run-1",
      cmp: "eq",
    });
  });

  it("returns existing row without writing when patch is empty", async () => {
    const existing = { id: "run-1", status: "completed" };
    const sb = makeSupabase({ singleRow: existing });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await updateOperatorRun(sb as any, "run-1", {});
    expect(row.id).toBe("run-1");
    // Only the maybeSingle read happens — no update is issued.
    expect(sb.queries.find((q) => q.op === "update")).toBeUndefined();
  });

  it("maps notesCreated and durationMs to snake_case columns", async () => {
    const sb = makeSupabase({ updatedRow: { id: "run-1" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateOperatorRun(sb as any, "run-1", {
      notesCreated: ["n-1", "n-2"],
      durationMs: 1234,
      branchId: "branch-9",
    });
    expect(sb.queries[0].payload).toEqual({
      notes_created: ["n-1", "n-2"],
      duration_ms: 1234,
      branch_id: "branch-9",
    });
  });
});

// ─── listOperatorRuns ────────────────────────────────────────────────────────

describe("listOperatorRuns", () => {
  it("returns rows with no nextCursor when fewer than limit are returned", async () => {
    const rows: Partial<WorkspaceOperatorRunRow>[] = [
      { id: "a", created_at: "2026-04-19T03:00:00Z" },
      { id: "b", created_at: "2026-04-19T02:00:00Z" },
    ];
    const sb = makeSupabase({ selectRows: rows as Record<string, unknown>[] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listOperatorRuns(sb as any, {
      userId: "user-1",
      limit: 25,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
    expect(sb.queries[0].limit).toBe(25);
    expect(sb.queries[0].ordered).toEqual({ col: "created_at", ascending: false });
    expect(sb.queries[0].filters).toContainEqual({
      col: "user_id",
      val: "user-1",
      cmp: "eq",
    });
  });

  it("emits a nextCursor when the page is full", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `run-${i}`,
      created_at: `2026-04-19T0${3 - i}:00:00Z`,
    }));
    const sb = makeSupabase({ selectRows: rows });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listOperatorRuns(sb as any, { limit: 3 });
    expect(result.rows).toHaveLength(3);
    expect(result.nextCursor).toBe("2026-04-19T01:00:00Z");
  });

  it("applies the cursor as a created_at < filter for next-page reads", async () => {
    const sb = makeSupabase({ selectRows: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await listOperatorRuns(sb as any, {
      workspaceId: "ws-1",
      cursor: "2026-04-19T01:00:00Z",
      limit: 10,
    });
    expect(sb.queries[0].filters).toContainEqual({
      col: "workspace_id",
      val: "ws-1",
      cmp: "eq",
    });
    expect(sb.queries[0].filters).toContainEqual({
      col: "created_at",
      val: "2026-04-19T01:00:00Z",
      cmp: "lt",
    });
  });

  it("clamps a too-large limit to 100", async () => {
    const sb = makeSupabase({ selectRows: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await listOperatorRuns(sb as any, { limit: 9999 });
    expect(sb.queries[0].limit).toBe(100);
  });
});

// ─── getOperatorRun ──────────────────────────────────────────────────────────

describe("getOperatorRun", () => {
  it("returns the row when present", async () => {
    const row = { id: "run-1", status: "completed" };
    const sb = makeSupabase({ singleRow: row });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getOperatorRun(sb as any, "run-1");
    expect(result?.id).toBe("run-1");
    expect(sb.queries[0].filters).toContainEqual({
      col: "id",
      val: "run-1",
      cmp: "eq",
    });
  });

  it("returns null when no row matches", async () => {
    const sb = makeSupabase({ singleRow: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getOperatorRun(sb as any, "nonexistent");
    expect(result).toBeNull();
  });
});
