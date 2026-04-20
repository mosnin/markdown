import { describe, it, expect } from "vitest";
import {
  cancelOperatorRun,
  retryOperatorRun,
} from "@/server/services/workspace_operator_service";

/**
 * Wave 1 F — `cancelOperatorRun` + `retryOperatorRun` server helpers.
 *
 * These are the API surface Wave 2 Agent H wires up to the Cancel button and
 * the Retry action. We assert:
 *   - cancel: ownership enforcement, no-op for terminal runs, sets the
 *     timestamp column for live runs
 *   - retry: ownership enforcement, terminal-only, copies prompt + branch +
 *     mode + model + budget onto a fresh row (without dispatching)
 *
 * Fake-Supabase mirrors the chain we already use in
 * `workspace_operator_runs_service.test.ts` so these tests stay readable
 * without dragging the integration harness in.
 */

interface QueryRecord {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: Record<string, unknown>;
  filters: Array<{ col: string; val: unknown; cmp: "eq" | "lt" }>;
}

interface FakeSupabaseOpts {
  // Multiple maybeSingle / single results, served in order.
  reads?: Array<Record<string, unknown> | null>;
  inserts?: Array<Record<string, unknown>>;
  updates?: Array<Record<string, unknown>>;
}

function makeSupabase(opts: FakeSupabaseOpts) {
  const queries: QueryRecord[] = [];
  const reads = [...(opts.reads ?? [])];
  const inserts = [...(opts.inserts ?? [])];
  const updates = [...(opts.updates ?? [])];

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
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      record.filters.push({ col, val, cmp: "eq" });
      return b;
    };
    b.single = async () => {
      queries.push(record);
      if (record.op === "insert") {
        return { data: inserts.shift() ?? record.payload, error: null };
      }
      if (record.op === "update") {
        return { data: updates.shift() ?? record.payload, error: null };
      }
      return { data: reads.shift() ?? null, error: null };
    };
    b.maybeSingle = async () => {
      queries.push(record);
      return { data: reads.shift() ?? null, error: null };
    };
    return b;
  }

  return { from: builder, queries };
}

const RUN_OWNER = "00000000-0000-0000-0000-000000000001";
const OTHER_USER = "00000000-0000-0000-0000-00000000ffff";

const baseRow: Record<string, unknown> = {
  id: "run-1",
  workspace_id: "ws-1",
  user_id: RUN_OWNER,
  branch_id: "br-1",
  prompt: "Draft a brief on Q1 roadmap",
  mode: "full",
  status: "executing",
  cancellation_requested_at: null,
  model: "gpt-4.1-mini",
  max_input_tokens: 5000,
  max_output_tokens: 1000,
};

// ─── cancelOperatorRun ───────────────────────────────────────────────────────

describe("cancelOperatorRun", () => {
  it("flips cancellation_requested_at on a live run owned by the caller", async () => {
    const sb = makeSupabase({
      reads: [baseRow],
      updates: [{ ...baseRow, cancellation_requested_at: "2026-04-20T00:00:00.000Z" }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await cancelOperatorRun(sb as any, "run-1", RUN_OWNER);
    expect(row.cancellation_requested_at).not.toBeNull();
    // Should have read first, then updated.
    expect(sb.queries[0].op).toBe("select");
    expect(sb.queries[1].op).toBe("update");
    // The patch only touches cancellation_requested_at — never `status`.
    const update = sb.queries[1].payload as Record<string, unknown>;
    expect(Object.keys(update)).toEqual(["cancellation_requested_at"]);
    expect(typeof update.cancellation_requested_at).toBe("string");
  });

  it("rejects when the requesting user does not own the run", async () => {
    const sb = makeSupabase({ reads: [baseRow] });
    await expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cancelOperatorRun(sb as any, "run-1", OTHER_USER)
    ).rejects.toThrow(/forbidden/);
    // No update was attempted.
    expect(sb.queries.find((q) => q.op === "update")).toBeUndefined();
  });

  it("throws when the run is not found", async () => {
    const sb = makeSupabase({ reads: [null] });
    await expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cancelOperatorRun(sb as any, "nope", RUN_OWNER)
    ).rejects.toThrow(/not found/);
  });

  it("is a no-op when the run is already terminal (completed)", async () => {
    const completed = { ...baseRow, status: "completed" };
    const sb = makeSupabase({ reads: [completed] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await cancelOperatorRun(sb as any, "run-1", RUN_OWNER);
    expect(row.status).toBe("completed");
    expect(sb.queries.find((q) => q.op === "update")).toBeUndefined();
  });

  it("is a no-op for already-cancelled runs", async () => {
    const cancelled = { ...baseRow, status: "cancelled" };
    const sb = makeSupabase({ reads: [cancelled] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await cancelOperatorRun(sb as any, "run-1", RUN_OWNER);
    expect(sb.queries.find((q) => q.op === "update")).toBeUndefined();
  });

  it("is a no-op when cancellation has already been requested", async () => {
    const alreadyRequested = {
      ...baseRow,
      cancellation_requested_at: "2026-04-19T00:00:00.000Z",
    };
    const sb = makeSupabase({ reads: [alreadyRequested] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await cancelOperatorRun(sb as any, "run-1", RUN_OWNER);
    expect(sb.queries.find((q) => q.op === "update")).toBeUndefined();
  });
});

// ─── retryOperatorRun ────────────────────────────────────────────────────────

describe("retryOperatorRun", () => {
  it("creates a fresh row copying prompt/branch/mode/model/budget from the source", async () => {
    const completed = { ...baseRow, status: "completed", id: "run-old" };
    const newRow = { ...completed, id: "run-new", status: "queued" };
    const sb = makeSupabase({
      reads: [completed],
      inserts: [newRow],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await retryOperatorRun(sb as any, "run-old", RUN_OWNER);
    expect(row.id).toBe("run-new");
    expect(row.status).toBe("queued");

    const insert = sb.queries.find((q) => q.op === "insert")!;
    const payload = insert.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      workspace_id: "ws-1",
      user_id: RUN_OWNER,
      branch_id: "br-1",
      prompt: "Draft a brief on Q1 roadmap",
      mode: "full",
      status: "queued",
      model: "gpt-4.1-mini",
      max_input_tokens: 5000,
      max_output_tokens: 1000,
    });
  });

  it("rejects when the requesting user does not own the run", async () => {
    const completed = { ...baseRow, status: "completed" };
    const sb = makeSupabase({ reads: [completed] });
    await expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      retryOperatorRun(sb as any, "run-old", OTHER_USER)
    ).rejects.toThrow(/forbidden/);
  });

  it("rejects when the run is non-terminal", async () => {
    const inflight = { ...baseRow, status: "executing" };
    const sb = makeSupabase({ reads: [inflight] });
    await expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      retryOperatorRun(sb as any, "run-1", RUN_OWNER)
    ).rejects.toThrow(/non-terminal/);
  });

  it("rejects when the run is not found", async () => {
    const sb = makeSupabase({ reads: [null] });
    await expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      retryOperatorRun(sb as any, "nope", RUN_OWNER)
    ).rejects.toThrow(/not found/);
  });

  it("does NOT call the Modal endpoint — only writes the row", async () => {
    const failed = { ...baseRow, status: "failed", id: "run-old" };
    const newRow = { ...failed, id: "run-new", status: "queued" };
    const sb = makeSupabase({ reads: [failed], inserts: [newRow] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await retryOperatorRun(sb as any, "run-old", RUN_OWNER);
    // The fake-supabase chain doesn't speak fetch — if retry tried to
    // dispatch we'd see a hung promise, not a write. The presence of just
    // one insert + the original read is the signal here.
    const ops = sb.queries.map((q) => q.op);
    expect(ops).toEqual(["select", "insert"]);
  });
});
