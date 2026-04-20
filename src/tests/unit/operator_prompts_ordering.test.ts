import { describe, it, expect } from "vitest";

import {
  createOperatorPrompt,
  listOperatorPrompts,
  reorderOperatorPrompts,
} from "@/server/services/operator_prompts_service";

// ---------------------------------------------------------------------------
// Coverage for Operator-gap #9: explicit user-managed sort_order on
// saved prompts. The fake below is a per-table in-memory Supabase stand-in
// that actually mutates rows on insert / update / select — unlike the
// thinner fake in operator_prompts_service.test.ts, which only records
// calls. We need the mutating version here so a "swap two rows and
// re-list" test can observe the new ordering end-to-end.
//
// The fake implements just the subset of the PostgREST builder surface
// the service touches: from / select / insert / update / eq / in /
// order / single. No `limit` — the service deliberately avoids it so
// the thinner fake in the sibling test file keeps working.
// ---------------------------------------------------------------------------

type Row = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  prompt: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

interface FilterClause {
  col: string;
  op: "eq" | "in";
  val: unknown;
}

function makeSupabase(initial: Row[] = []) {
  const rows: Row[] = initial.map((r) => ({ ...r }));
  let nextId = initial.length + 1;

  function builder(table: string) {
    if (table !== "workspace_operator_prompts") {
      throw new Error(`unexpected table ${table}`);
    }

    let mode: "select" | "insert" | "update" | "delete" = "select";
    let selectCols: string | undefined;
    let insertPayload: Partial<Row> | undefined;
    let updatePayload: Partial<Row> | undefined;
    const filters: FilterClause[] = [];
    const orders: Array<{ col: keyof Row; ascending: boolean }> = [];

    function applyFilters(r: Row): boolean {
      for (const f of filters) {
        if (f.op === "eq") {
          if ((r as unknown as Record<string, unknown>)[f.col] !== f.val) {
            return false;
          }
        } else if (f.op === "in") {
          const vals = f.val as unknown[];
          if (!vals.includes((r as unknown as Record<string, unknown>)[f.col])) {
            return false;
          }
        }
      }
      return true;
    }

    function applyOrders(a: Row, b: Row): number {
      for (const o of orders) {
        const av = a[o.col];
        const bv = b[o.col];
        if (av === bv) continue;
        if (o.ascending) return av < bv ? -1 : 1;
        return av < bv ? 1 : -1;
      }
      return 0;
    }

    function materialise(): Row[] {
      const matches = rows.filter(applyFilters);
      if (orders.length > 0) matches.sort(applyOrders);
      return matches.map((r) => ({ ...r }));
    }

    const b: Record<string, unknown> = {};
    b.select = (cols?: string) => {
      selectCols = cols;
      return b;
    };
    b.insert = (payload: Partial<Row>) => {
      mode = "insert";
      insertPayload = payload;
      return b;
    };
    b.update = (payload: Partial<Row>) => {
      mode = "update";
      updatePayload = payload;
      return b;
    };
    b.eq = (col: string, val: unknown) => {
      filters.push({ col, op: "eq", val });
      return b;
    };
    b.in = (col: string, val: unknown[]) => {
      filters.push({ col, op: "in", val });
      return b;
    };
    b.order = (col: keyof Row, opts: { ascending: boolean }) => {
      orders.push({ col, ascending: opts.ascending });
      return b;
    };
    b.single = async () => {
      if (mode === "insert") {
        const now = "2026-04-20T00:00:00Z";
        const row: Row = {
          id: `p${nextId++}`,
          workspace_id: (insertPayload?.workspace_id as string) ?? "",
          user_id: (insertPayload?.user_id as string) ?? "",
          name: (insertPayload?.name as string) ?? "",
          prompt: (insertPayload?.prompt as string) ?? "",
          sort_order: (insertPayload?.sort_order as number) ?? 0,
          created_at: now,
          updated_at: now,
        };
        rows.push(row);
        return { data: { ...row }, error: null };
      }
      if (mode === "update") {
        const target = rows.find(applyFilters);
        if (!target) return { data: null, error: null };
        Object.assign(target, updatePayload);
        return { data: { ...target }, error: null };
      }
      const first = materialise()[0] ?? null;
      return { data: first, error: null };
    };
    b.maybeSingle = async () => {
      if (mode === "update") {
        const target = rows.find(applyFilters);
        if (!target) return { data: null, error: null };
        Object.assign(target, updatePayload);
        return { data: { ...target }, error: null };
      }
      const first = materialise()[0] ?? null;
      return { data: first, error: null };
    };
    // `then` lets `await builder` resolve without an explicit
    // terminator — matches what PostgREST's builder does.
    b.then = (resolve: (v: unknown) => void) => {
      if (mode === "update") {
        const targets = rows.filter(applyFilters);
        for (const t of targets) Object.assign(t, updatePayload);
        resolve({ data: targets.map((r) => ({ ...r })), error: null });
        return;
      }
      // Strip the select columns down to what was asked for, if any —
      // the service calls `.select("sort_order")` for the max query
      // and we want that array to look realistic.
      const raw = materialise();
      if (selectCols && selectCols !== "*") {
        const picked = selectCols.split(",").map((s) => s.trim());
        resolve({
          data: raw.map((r) => {
            const o: Record<string, unknown> = {};
            for (const c of picked) {
              o[c] = (r as unknown as Record<string, unknown>)[c];
            }
            return o;
          }),
          error: null,
        });
        return;
      }
      resolve({ data: raw, error: null });
    };
    return b;
  }
  return { from: builder, rows };
}

function seedRows(overrides: Partial<Row>[] = []): Row[] {
  const base: Row = {
    id: "",
    workspace_id: "ws-1",
    user_id: "u-1",
    name: "",
    prompt: "body",
    sort_order: 0,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
  };
  return overrides.map((o, i) => ({
    ...base,
    id: `p${i + 1}`,
    name: `Prompt ${i + 1}`,
    ...o,
  }));
}

// ─── reorderOperatorPrompts ─────────────────────────────────────────────────

describe("reorderOperatorPrompts", () => {
  it("swaps two rows and returns the re-sorted list", async () => {
    const initial = seedRows([
      { id: "p1", name: "A", sort_order: 0 },
      { id: "p2", name: "B", sort_order: 1 },
      { id: "p3", name: "C", sort_order: 2 },
    ]);
    const fake = makeSupabase(initial);

    // Promote B above A (swap sort_order 0 and 1).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await reorderOperatorPrompts(fake as any, "u-1", [
      { id: "p2", sort_order: 0 },
      { id: "p1", sort_order: 1 },
    ]);

    expect(result.map((r) => r.id)).toEqual(["p2", "p1", "p3"]);
    expect(result.map((r) => r.sort_order)).toEqual([0, 1, 2]);
  });

  it("rejects ids that do not belong to the caller", async () => {
    const initial = seedRows([
      { id: "p1", user_id: "u-1", sort_order: 0 },
      // Owned by a DIFFERENT user — the service must refuse to move it.
      { id: "p2", user_id: "u-2", sort_order: 1 },
    ]);
    const fake = makeSupabase(initial);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reorderOperatorPrompts(fake as any, "u-1", [
        { id: "p1", sort_order: 1 },
        { id: "p2", sort_order: 0 },
      ])
    ).rejects.toThrow(/do not belong/i);
  });

  it("rejects duplicate ids in the input", async () => {
    const fake = makeSupabase(seedRows([{ id: "p1", sort_order: 0 }]));
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reorderOperatorPrompts(fake as any, "u-1", [
        { id: "p1", sort_order: 0 },
        { id: "p1", sort_order: 1 },
      ])
    ).rejects.toThrow(/duplicate id/i);
  });

  it("refuses an empty batch", async () => {
    const fake = makeSupabase([]);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reorderOperatorPrompts(fake as any, "u-1", [])
    ).rejects.toThrow(/no reorder items/i);
  });
});

// ─── createOperatorPrompt — sort_order defaulting ──────────────────────────

describe("createOperatorPrompt default sort_order", () => {
  it("places the first row at sort_order 0", async () => {
    const fake = makeSupabase([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await createOperatorPrompt(fake as any, {
      workspaceId: "ws-1",
      userId: "u-1",
      name: "First",
      prompt: "Body",
    });
    expect(row.sort_order).toBe(0);
  });

  it("places subsequent rows at max + 1", async () => {
    const initial = seedRows([
      { id: "p1", sort_order: 0 },
      { id: "p2", sort_order: 1 },
      { id: "p3", sort_order: 5 },
    ]);
    const fake = makeSupabase(initial);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await createOperatorPrompt(fake as any, {
      workspaceId: "ws-1",
      userId: "u-1",
      name: "New",
      prompt: "Body",
    });
    expect(row.sort_order).toBe(6);
  });
});

// ─── listOperatorPrompts — ordering stability ──────────────────────────────

describe("listOperatorPrompts ordering", () => {
  it("orders by sort_order ascending, updated_at descending as tiebreak", async () => {
    const initial = seedRows([
      {
        id: "p1",
        name: "Older tied",
        sort_order: 0,
        updated_at: "2026-04-01T00:00:00Z",
      },
      {
        id: "p2",
        name: "Newer tied",
        sort_order: 0,
        updated_at: "2026-04-15T00:00:00Z",
      },
      {
        id: "p3",
        name: "Last slot",
        sort_order: 2,
        updated_at: "2026-04-20T00:00:00Z",
      },
      {
        id: "p4",
        name: "Middle",
        sort_order: 1,
        updated_at: "2026-04-10T00:00:00Z",
      },
    ]);
    const fake = makeSupabase(initial);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await listOperatorPrompts(fake as any, {
      workspaceId: "ws-1",
      userId: "u-1",
    });
    // sort_order 0 group: p2 (newer) before p1 (older).
    // Then sort_order 1 (p4). Then sort_order 2 (p3).
    expect(rows.map((r) => r.id)).toEqual(["p2", "p1", "p4", "p3"]);
  });
});
