import { describe, it, expect } from "vitest";

import {
  listOperatorPrompts,
  createOperatorPrompt,
  updateOperatorPrompt,
  deleteOperatorPrompt,
  getOperatorPrompt,
} from "@/server/services/operator_prompts_service";

// ─── Fake Supabase chain (PostgREST builder shape) ──────────────────────────
//
// Mirrors the same chain the production service exercises. Mirrors the
// pattern in workspace_operator_runs_service.test.ts but trimmed to the
// surfaces operator_prompts_service uses.

interface QueryRecord {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: Record<string, unknown>;
  filters: Array<{ col: string; val: unknown; cmp: "eq" | "is" }>;
  ordered?: { col: string; ascending: boolean };
}

interface FakeOpts {
  insertedRow?: Record<string, unknown> | null;
  insertedError?: { code?: string; message: string } | null;
  updatedRow?: Record<string, unknown> | null;
  updatedError?: { code?: string; message: string } | null;
  selectRows?: Array<Record<string, unknown>>;
  singleRow?: Record<string, unknown> | null;
  deleteRows?: Array<Record<string, unknown>>;
}

function makeSupabase(opts: FakeOpts) {
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
    b.delete = () => {
      record.op = "delete";
      return b;
    };
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      record.filters.push({ col, val, cmp: "eq" });
      return b;
    };
    b.is = (col: string, val: unknown) => {
      record.filters.push({ col, val, cmp: "is" });
      return b;
    };
    b.order = (col: string, o: { ascending: boolean }) => {
      record.ordered = { col, ascending: o.ascending };
      return b;
    };
    b.single = async () => {
      queries.push(record);
      if (record.op === "insert") {
        return {
          data: opts.insertedRow ?? record.payload ?? null,
          error: opts.insertedError ?? null,
        };
      }
      if (record.op === "update") {
        return {
          data: opts.updatedRow ?? record.payload ?? null,
          error: opts.updatedError ?? null,
        };
      }
      return { data: opts.singleRow ?? null, error: null };
    };
    b.maybeSingle = async () => {
      queries.push(record);
      if (record.op === "update") {
        return {
          data: opts.updatedRow ?? null,
          error: opts.updatedError ?? null,
        };
      }
      return { data: opts.singleRow ?? null, error: null };
    };
    b.then = (resolve: (v: unknown) => void) => {
      queries.push(record);
      if (record.op === "delete") {
        resolve({ data: opts.deleteRows ?? [], error: null });
        return;
      }
      resolve({ data: opts.selectRows ?? [], error: null });
    };
    return b;
  }
  return { from: builder, queries };
}

// ─── listOperatorPrompts ────────────────────────────────────────────────────

describe("listOperatorPrompts", () => {
  it("filters by workspace and user, ordered by updated_at desc", async () => {
    const fake = makeSupabase({
      selectRows: [
        {
          id: "p1",
          workspace_id: "ws-1",
          user_id: "u-1",
          name: "Brief",
          prompt: "Draft Q1 brief",
          created_at: "2026-04-19T00:00:00Z",
          updated_at: "2026-04-20T00:00:00Z",
        },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await listOperatorPrompts(fake as any, {
      workspaceId: "ws-1",
      userId: "u-1",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("p1");
    const q = fake.queries[0];
    expect(q?.table).toBe("workspace_operator_prompts");
    expect(q?.filters).toEqual([
      { col: "workspace_id", val: "ws-1", cmp: "eq" },
      { col: "user_id", val: "u-1", cmp: "eq" },
    ]);
    expect(q?.ordered).toEqual({ col: "updated_at", ascending: false });
  });
});

// ─── createOperatorPrompt ───────────────────────────────────────────────────

describe("createOperatorPrompt", () => {
  it("trims name and prompt, then inserts a row", async () => {
    const fake = makeSupabase({
      insertedRow: {
        id: "p2",
        workspace_id: "ws-1",
        user_id: "u-1",
        name: "Trimmed",
        prompt: "Body",
        created_at: "2026-04-20T00:00:00Z",
        updated_at: "2026-04-20T00:00:00Z",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await createOperatorPrompt(fake as any, {
      workspaceId: "ws-1",
      userId: "u-1",
      name: "  Trimmed  ",
      prompt: " Body ",
    });
    expect(row.id).toBe("p2");
    const q = fake.queries[0];
    expect(q?.op).toBe("insert");
    expect(q?.payload).toMatchObject({
      workspace_id: "ws-1",
      user_id: "u-1",
      name: "Trimmed",
      prompt: "Body",
    });
  });

  it("rejects empty names / prompts", async () => {
    const fake = makeSupabase({});
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createOperatorPrompt(fake as any, {
        workspaceId: "ws-1",
        userId: "u-1",
        name: "  ",
        prompt: "Body",
      })
    ).rejects.toThrow(/name is required/i);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createOperatorPrompt(fake as any, {
        workspaceId: "ws-1",
        userId: "u-1",
        name: "Name",
        prompt: "   ",
      })
    ).rejects.toThrow(/body is required/i);
  });

  it("rejects names over 80 chars and prompts over 4000 chars", async () => {
    const fake = makeSupabase({});
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createOperatorPrompt(fake as any, {
        workspaceId: "ws-1",
        userId: "u-1",
        name: "x".repeat(81),
        prompt: "Body",
      })
    ).rejects.toThrow(/80 characters/);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createOperatorPrompt(fake as any, {
        workspaceId: "ws-1",
        userId: "u-1",
        name: "Name",
        prompt: "y".repeat(4001),
      })
    ).rejects.toThrow(/4000 characters/);
  });

  it("translates a Postgres unique-violation into a friendly message", async () => {
    const fake = makeSupabase({
      insertedRow: null,
      insertedError: { code: "23505", message: "duplicate key" },
    });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createOperatorPrompt(fake as any, {
        workspaceId: "ws-1",
        userId: "u-1",
        name: "Brief",
        prompt: "Body",
      })
    ).rejects.toThrow(/already exists/i);
  });
});

// ─── updateOperatorPrompt ───────────────────────────────────────────────────

describe("updateOperatorPrompt", () => {
  it("only writes fields present in the patch", async () => {
    const fake = makeSupabase({
      updatedRow: {
        id: "p3",
        workspace_id: "ws-1",
        user_id: "u-1",
        name: "New",
        prompt: "Body",
        created_at: "2026-04-20T00:00:00Z",
        updated_at: "2026-04-20T01:00:00Z",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await updateOperatorPrompt(fake as any, "p3", "u-1", {
      name: "New",
    });
    expect(row.name).toBe("New");
    const q = fake.queries[0];
    expect(q?.op).toBe("update");
    expect(q?.payload).toEqual({ name: "New" });
    expect(q?.filters).toEqual([
      { col: "id", val: "p3", cmp: "eq" },
      { col: "user_id", val: "u-1", cmp: "eq" },
    ]);
  });

  it("returns the existing row when patch is empty", async () => {
    const fake = makeSupabase({
      singleRow: {
        id: "p4",
        workspace_id: "ws-1",
        user_id: "u-1",
        name: "Same",
        prompt: "Body",
        created_at: "2026-04-20T00:00:00Z",
        updated_at: "2026-04-20T00:00:00Z",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await updateOperatorPrompt(fake as any, "p4", "u-1", {});
    expect(row.id).toBe("p4");
  });

  it("throws when no row matches the (id, user) tuple", async () => {
    const fake = makeSupabase({ updatedRow: null });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateOperatorPrompt(fake as any, "missing", "u-1", { name: "n" })
    ).rejects.toThrow(/not found/i);
  });
});

// ─── deleteOperatorPrompt ───────────────────────────────────────────────────

describe("deleteOperatorPrompt", () => {
  it("returns true when a row is deleted", async () => {
    const fake = makeSupabase({ deleteRows: [{ id: "p5" }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await deleteOperatorPrompt(fake as any, "p5", "u-1");
    expect(ok).toBe(true);
    const q = fake.queries[0];
    expect(q?.op).toBe("delete");
    expect(q?.filters).toEqual([
      { col: "id", val: "p5", cmp: "eq" },
      { col: "user_id", val: "u-1", cmp: "eq" },
    ]);
  });

  it("returns false when nothing matched", async () => {
    const fake = makeSupabase({ deleteRows: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await deleteOperatorPrompt(fake as any, "missing", "u-1");
    expect(ok).toBe(false);
  });
});

// ─── getOperatorPrompt ──────────────────────────────────────────────────────

describe("getOperatorPrompt", () => {
  it("returns null when no row matches", async () => {
    const fake = makeSupabase({ singleRow: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await getOperatorPrompt(fake as any, "p6", "u-1");
    expect(row).toBeNull();
  });
});
