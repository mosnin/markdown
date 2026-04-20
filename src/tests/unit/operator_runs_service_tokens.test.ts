import { describe, it, expect } from "vitest";

import { updateOperatorRun } from "@/server/services/workspace_operator_runs_service";

/**
 * Phase 4 — updateOperatorRun persists token columns.
 *
 * Mirrors the fake-supabase pattern in workspace_operator_runs_service.test.ts
 * (we copy the minimum needed to exercise updateOperatorRun specifically)
 * and asserts the snake_case column mapping for the new token fields.
 */

interface QueryRecord {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: Record<string, unknown>;
  filters: Array<{ col: string; val: unknown; cmp: "eq" | "lt" }>;
}

interface FakeSupabaseOpts {
  updatedRow?: Record<string, unknown>;
  singleRow?: Record<string, unknown> | null;
}

function makeSupabase(opts: FakeSupabaseOpts) {
  const queries: QueryRecord[] = [];

  function builder(table: string) {
    const record: QueryRecord = { table, op: "select", filters: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: Record<string, any> = {};

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
      if (record.op === "update") {
        return { data: opts.updatedRow ?? record.payload, error: null };
      }
      return { data: opts.singleRow ?? null, error: null };
    };
    b.maybeSingle = async () => {
      queries.push(record);
      return { data: opts.singleRow ?? null, error: null };
    };
    return b;
  }

  return { from: builder, queries };
}

describe("updateOperatorRun — Phase 4 token columns", () => {
  it("persists input_tokens, output_tokens, cached_input_tokens, and model", async () => {
    const sb = makeSupabase({
      updatedRow: {
        id: "run-1",
        input_tokens: 2500,
        output_tokens: 400,
        cached_input_tokens: 1900,
        model: "gpt-4.1-mini",
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await updateOperatorRun(sb as any, "run-1", {
      inputTokens: 2500,
      outputTokens: 400,
      cachedInputTokens: 1900,
      model: "gpt-4.1-mini",
    });

    expect(row.input_tokens).toBe(2500);
    expect(row.output_tokens).toBe(400);
    expect(row.cached_input_tokens).toBe(1900);
    expect(row.model).toBe("gpt-4.1-mini");

    // The camelCase → snake_case mapping is load-bearing for the DB call.
    expect(sb.queries[0].op).toBe("update");
    expect(sb.queries[0].payload).toEqual({
      input_tokens: 2500,
      output_tokens: 400,
      cached_input_tokens: 1900,
      model: "gpt-4.1-mini",
    });
  });

  it("allows clearing the model field with null", async () => {
    const sb = makeSupabase({ updatedRow: { id: "run-1", model: null } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateOperatorRun(sb as any, "run-1", {
      model: null,
    });

    expect(sb.queries[0].payload).toEqual({ model: null });
  });

  it("only sets token fields when they're provided in the patch", async () => {
    const sb = makeSupabase({ updatedRow: { id: "run-1", status: "completed" } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateOperatorRun(sb as any, "run-1", {
      status: "completed",
    });

    // The patch carried only `status`; none of the token columns should appear.
    expect(sb.queries[0].payload).toEqual({ status: "completed" });
  });

  it("coexists with other fields on the same patch without interference", async () => {
    const sb = makeSupabase({ updatedRow: { id: "run-1" } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateOperatorRun(sb as any, "run-1", {
      status: "completed",
      toolCalls: 4,
      notesCreated: ["n1"],
      durationMs: 1200,
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 25,
      model: "gpt-4.1-mini",
    });

    expect(sb.queries[0].payload).toEqual({
      status: "completed",
      tool_calls: 4,
      notes_created: ["n1"],
      duration_ms: 1200,
      input_tokens: 100,
      output_tokens: 50,
      cached_input_tokens: 25,
      model: "gpt-4.1-mini",
    });
  });
});
