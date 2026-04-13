import { describe, it, expect } from "vitest";

/**
 * Unit tests for the box metadata overlay — the per-(branch, box)
 * overlay that closes the main-mutating leak in `updateBoxAction`.
 *
 * Invariants:
 *
 *   1. `upsertBoxMetadataOverlay` writes only the declared fields
 *      and uses the (branch_id, box_id) conflict target.
 *   2. `applyBoxMetadataOverlay` patches name / description when
 *      the overlay has non-null values; main values are preserved
 *      when the overlay has undefined (absent) values.
 *   3. An explicit null in the overlay clears the field on read —
 *      distinguishing "no override" (undefined) from "explicitly
 *      clear" (null).
 */

import {
  upsertBoxMetadataOverlay,
  applyBoxMetadataOverlay,
} from "@/server/services/box_branch_metadata_service";

const BRANCH = "branch-b";
const BOX = "box-1";

interface Call {
  table: string;
  op: "upsert" | "delete" | "select";
  args?: Record<string, unknown>;
  filters: Array<{ col: string; val: unknown }>;
}

function makeSupabase(returnRow?: Record<string, unknown>) {
  const calls: Call[] = [];
  function builder(table: string) {
    let op: Call["op"] = "select";
    const filters: Call["filters"] = [];
    let args: Record<string, unknown> | undefined;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      filters.push({ col, val });
      return b;
    };
    b.in = () => b;
    b.upsert = (payload: Record<string, unknown>, opts?: unknown) => {
      op = "upsert";
      args = { payload, opts };
      return b;
    };
    b.delete = () => {
      op = "delete";
      return b;
    };
    b.single = async () => {
      calls.push({ table, op, args, filters });
      return {
        data: returnRow ?? {
          id: "ov-1",
          branch_id: BRANCH,
          box_id: BOX,
          name: null,
          description: null,
          created_at: "",
          updated_at: "",
        },
        error: null,
      };
    };
    b.maybeSingle = async () => {
      calls.push({ table, op, args, filters });
      return { data: returnRow ?? null, error: null };
    };
    b.then = async (resolve: (v: { data: unknown[]; error: null }) => void) => {
      calls.push({ table, op, args, filters });
      resolve({ data: [], error: null });
    };
    return b;
  }
  return { supabase: { from: (t: string) => builder(t) } as never, calls };
}

describe("upsertBoxMetadataOverlay", () => {
  it("upserts on (branch_id, box_id) with only declared fields", async () => {
    const { supabase, calls } = makeSupabase();
    await upsertBoxMetadataOverlay(supabase, {
      branchId: BRANCH,
      boxId: BOX,
      name: "Renamed",
    });
    const upsert = calls.find((c) => c.op === "upsert")!;
    expect(upsert.table).toBe("box_branch_metadata_overlay");
    const a = upsert.args as { payload: Record<string, unknown>; opts: { onConflict: string } };
    expect(a.payload).toEqual({
      branch_id: BRANCH,
      box_id: BOX,
      name: "Renamed",
    });
    expect(a.opts.onConflict).toBe("branch_id,box_id");
  });

  it("omits undefined fields from the upsert payload", async () => {
    const { supabase, calls } = makeSupabase();
    await upsertBoxMetadataOverlay(supabase, {
      branchId: BRANCH,
      boxId: BOX,
      description: "new desc",
    });
    const upsert = calls.find((c) => c.op === "upsert")!;
    const payload = (upsert.args as { payload: Record<string, unknown> }).payload;
    expect(payload).toEqual({ branch_id: BRANCH, box_id: BOX, description: "new desc" });
    expect("name" in payload).toBe(false);
  });
});

describe("applyBoxMetadataOverlay", () => {
  const mainBox = { id: BOX, name: "Main Name", description: "main desc" };

  it("patches name + description when overlay has non-null values", () => {
    const out = applyBoxMetadataOverlay(mainBox, {
      id: "ov",
      branch_id: BRANCH,
      box_id: BOX,
      name: "Branch Name",
      description: "branch desc",
      created_at: "",
      updated_at: "",
    });
    expect(out.name).toBe("Branch Name");
    expect(out.description).toBe("branch desc");
  });

  it("preserves main when overlay is null (no override)", () => {
    const out = applyBoxMetadataOverlay(mainBox, null);
    expect(out).toEqual(mainBox);
  });

  it("null in overlay means no override — main value preserved", () => {
    // The overlay row stores null for columns the user hasn't set;
    // reads must treat null symmetrically with "inherit from main"
    // so a partial upsert (name only) doesn't wipe the canonical
    // description.
    const out = applyBoxMetadataOverlay(mainBox, {
      id: "ov",
      branch_id: BRANCH,
      box_id: BOX,
      name: "Branch Name",
      description: null,
      created_at: "",
      updated_at: "",
    });
    expect(out.name).toBe("Branch Name");
    expect(out.description).toBe("main desc");
  });
});
