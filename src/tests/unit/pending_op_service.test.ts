import { describe, it, expect } from "vitest";

/**
 * Unit tests for `pending_op_service` — the soft-intent layer that
 * records branch-local structural ops (trash / archive / unarchive /
 * move / detach) against canonical main rows and replays them on
 * promote.
 *
 * Invariants we cover:
 *
 *   1. `recordPendingOp` upserts on the (branch, op_type, object) key
 *      so a second call with the same shape is idempotent.
 *   2. `getHiddenByPendingOps` returns a set keyed on "type:id" that
 *      contains only rows with op_type=trash (archive/move etc. leave
 *      the row visible).
 *   3. `dropPendingOps` can scope by op_type so "unarchive after
 *      archive" just drops the archive op without touching unrelated
 *      entries.
 *   4. `dropAllPendingOpsForBranch` removes every op for the branch.
 *   5. `applyPendingOp`:
 *        - trash/archive/unarchive update the target row's status
 *          and mark the op applied;
 *        - move writes only the fields present in the payload;
 *        - detach deletes the target row outright.
 */

import {
  recordPendingOp,
  getHiddenByPendingOps,
  dropPendingOps,
  dropAllPendingOpsForBranch,
  applyPendingOp,
  type PendingOp,
} from "@/server/services/pending_op_service";

const BRANCH_ID = "branch-1";
const ACTOR_ID = "user-1";

// ─── Test-local Supabase double ──────────────────────────────────────────────
//
// Records every call so the test can assert on the exact op issued.
// Stubs minimal chaining: `from(table).select().eq().is().order()` for
// reads and `.delete().eq()…` / `.update().eq()` for writes.

interface RecordedCall {
  table: string;
  op: "upsert" | "update" | "delete" | "select";
  args?: Record<string, unknown>;
  filters?: Array<{ col: string; val: unknown }>;
}

function makeSupabase(
  responses: {
    selectRows?: Record<string, unknown[]>;
    singleRow?: Record<string, unknown>;
    upsertReturn?: Record<string, unknown>;
  } = {}
) {
  const calls: RecordedCall[] = [];

  function builder(table: string) {
    let op: RecordedCall["op"] = "select";
    const filters: RecordedCall["filters"] = [];
    let args: Record<string, unknown> | undefined;

    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      filters!.push({ col, val });
      return b;
    };
    b.is = (col: string, val: unknown) => {
      filters!.push({ col, val });
      return b;
    };
    b.order = () => b;
    b.upsert = (payload: Record<string, unknown>, opts?: unknown) => {
      op = "upsert";
      args = { payload, opts };
      return b;
    };
    b.update = (payload: Record<string, unknown>) => {
      op = "update";
      args = { payload };
      return b;
    };
    b.delete = () => {
      op = "delete";
      return b;
    };
    b.in = (col: string, val: unknown) => {
      filters!.push({ col, val });
      return b;
    };
    b.single = async () => {
      calls.push({ table, op, args, filters });
      if (op === "upsert") {
        return { data: responses.upsertReturn ?? { id: "op-1" }, error: null };
      }
      return { data: responses.singleRow ?? null, error: null };
    };
    b.maybeSingle = async () => {
      calls.push({ table, op, args, filters });
      return { data: responses.singleRow ?? null, error: null };
    };
    b.then = async (resolve: (v: { data: unknown[]; error: null }) => void) => {
      calls.push({ table, op, args, filters });
      resolve({
        data: responses.selectRows?.[table] ?? [],
        error: null,
      });
    };
    return b;
  }

  return {
    supabase: { from: (table: string) => builder(table) } as never,
    calls,
  };
}

// ─── recordPendingOp ─────────────────────────────────────────────────────────

describe("recordPendingOp", () => {
  it("upserts with the (branch, op_type, object_type, object_id) conflict target", async () => {
    const { supabase, calls } = makeSupabase({
      upsertReturn: {
        id: "op-abc",
        branch_id: BRANCH_ID,
        op_type: "trash",
        object_type: "note",
        object_id: "note-1",
        payload: {},
        actor_id: ACTOR_ID,
        created_at: "now",
        applied_at: null,
      },
    });
    const op = await recordPendingOp(supabase, {
      branchId: BRANCH_ID,
      actorId: ACTOR_ID,
      opType: "trash",
      objectType: "note",
      objectId: "note-1",
    });
    expect(op.id).toBe("op-abc");
    const upsertCall = calls.find((c) => c.op === "upsert")!;
    expect(upsertCall.table).toBe("branch_pending_ops");
    const args = upsertCall.args as { payload: Record<string, unknown>; opts: { onConflict: string } };
    expect(args.payload).toMatchObject({
      branch_id: BRANCH_ID,
      op_type: "trash",
      object_type: "note",
      object_id: "note-1",
      actor_id: ACTOR_ID,
    });
    expect(args.opts.onConflict).toBe("branch_id,op_type,object_type,object_id");
  });
});

// ─── getHiddenByPendingOps ───────────────────────────────────────────────────

describe("getHiddenByPendingOps", () => {
  it("filters to op_type=trash and returns a set keyed on type:id", async () => {
    const { supabase, calls } = makeSupabase({
      selectRows: {
        branch_pending_ops: [
          { object_type: "note", object_id: "note-1" },
          { object_type: "file", object_id: "file-42" },
        ],
      },
    });
    const hidden = await getHiddenByPendingOps(supabase, BRANCH_ID);
    expect(hidden.has("note:note-1")).toBe(true);
    expect(hidden.has("file:file-42")).toBe(true);
    expect(hidden.size).toBe(2);

    const call = calls.find((c) => c.table === "branch_pending_ops")!;
    // Ensure the query filtered on op_type=trash and applied_at IS NULL —
    // archive/move ops must not hide rows.
    expect(call.filters).toContainEqual({ col: "branch_id", val: BRANCH_ID });
    expect(call.filters).toContainEqual({ col: "op_type", val: "trash" });
    expect(call.filters).toContainEqual({ col: "applied_at", val: null });
  });
});

// ─── dropPendingOps ──────────────────────────────────────────────────────────

describe("dropPendingOps", () => {
  it("scopes by op_type when provided so only that op is removed", async () => {
    const { supabase, calls } = makeSupabase();
    await dropPendingOps(supabase, {
      branchId: BRANCH_ID,
      objectType: "note",
      objectId: "note-1",
      opType: "archive",
    });
    const del = calls.find((c) => c.op === "delete")!;
    expect(del.table).toBe("branch_pending_ops");
    expect(del.filters).toContainEqual({ col: "branch_id", val: BRANCH_ID });
    expect(del.filters).toContainEqual({ col: "object_type", val: "note" });
    expect(del.filters).toContainEqual({ col: "object_id", val: "note-1" });
    expect(del.filters).toContainEqual({ col: "op_type", val: "archive" });
  });

  it("omits op_type filter when undefined so every op on the target is dropped", async () => {
    const { supabase, calls } = makeSupabase();
    await dropPendingOps(supabase, {
      branchId: BRANCH_ID,
      objectType: "note",
      objectId: "note-1",
    });
    const del = calls.find((c) => c.op === "delete")!;
    expect(del.filters?.some((f) => f.col === "op_type")).toBe(false);
  });
});

describe("dropAllPendingOpsForBranch", () => {
  it("deletes every row for the branch without any op_type filter", async () => {
    const { supabase, calls } = makeSupabase();
    await dropAllPendingOpsForBranch(supabase, BRANCH_ID);
    const del = calls.find((c) => c.op === "delete")!;
    expect(del.table).toBe("branch_pending_ops");
    expect(del.filters).toEqual([{ col: "branch_id", val: BRANCH_ID }]);
  });
});

// ─── applyPendingOp ──────────────────────────────────────────────────────────

/**
 * Helper: drive applyPendingOp with a synthesized op and a freshly
 * made supabase double whose `maybeSingle` returns the supplied
 * "before" row. Returns the recorded calls for assertion.
 */
async function runApply(
  op: PendingOp,
  beforeRow: Record<string, unknown> | null = null
) {
  const { supabase, calls } = makeSupabase({
    singleRow: beforeRow ?? undefined,
  });
  const res = await applyPendingOp(supabase, op);
  return { res, calls };
}

function makeOp(overrides: Partial<PendingOp> = {}): PendingOp {
  return {
    id: "op-1",
    branch_id: BRANCH_ID,
    op_type: "trash",
    object_type: "note",
    object_id: "note-1",
    payload: {},
    actor_id: ACTOR_ID,
    created_at: "now",
    applied_at: null,
    ...overrides,
  };
}

describe("applyPendingOp", () => {
  it("trash sets status=trashed on the target and marks the op applied", async () => {
    const { res, calls } = await runApply(
      makeOp({ op_type: "trash" }),
      { id: "note-1", status: "active" }
    );
    expect(res.after).toEqual({ status: "trashed" });
    expect(res.before).toEqual({ status: "active" });
    const statusUpdate = calls.find(
      (c) => c.table === "notes" && c.op === "update"
    )!;
    expect(statusUpdate.args).toEqual({ payload: { status: "trashed" } });
    const appliedUpdate = calls.find(
      (c) =>
        c.table === "branch_pending_ops" &&
        c.op === "update" &&
        (c.args as { payload: Record<string, unknown> }).payload.applied_at
    );
    expect(appliedUpdate).toBeDefined();
  });

  it("archive sets status=archived", async () => {
    const { res } = await runApply(
      makeOp({ op_type: "archive" }),
      { id: "note-1", status: "active" }
    );
    expect(res.after).toEqual({ status: "archived" });
  });

  it("unarchive sets status=active", async () => {
    const { res } = await runApply(
      makeOp({ op_type: "unarchive" }),
      { id: "note-1", status: "archived" }
    );
    expect(res.after).toEqual({ status: "active" });
  });

  it("move writes only the fields present in the payload", async () => {
    const { calls } = await runApply(
      makeOp({
        op_type: "move",
        payload: { folder_id: "folder-new", path_cache: "boxes/a/doc" },
      }),
      { folder_id: "folder-old", path_cache: "boxes/a/old" }
    );
    const moveUpdate = calls.find(
      (c) => c.table === "notes" && c.op === "update"
    )!;
    expect(moveUpdate.args).toEqual({
      payload: { folder_id: "folder-new", path_cache: "boxes/a/doc" },
    });
  });

  it("move with empty payload is a no-op but still marks the op applied", async () => {
    const { calls } = await runApply(
      makeOp({ op_type: "move", payload: {} })
    );
    const targetUpdate = calls.find(
      (c) => c.table === "notes" && c.op === "update"
    );
    expect(targetUpdate).toBeUndefined();
    const appliedUpdate = calls.find(
      (c) => c.table === "branch_pending_ops" && c.op === "update"
    );
    expect(appliedUpdate).toBeDefined();
  });

  it("detach deletes the target row outright", async () => {
    const { res, calls } = await runApply(
      makeOp({
        op_type: "detach",
        object_type: "object_link",
        object_id: "link-1",
      })
    );
    expect(res.after).toEqual({ deleted: true });
    const del = calls.find(
      (c) => c.table === "object_links" && c.op === "delete"
    )!;
    expect(del.filters).toContainEqual({ col: "id", val: "link-1" });
  });

  it("rejects unsupported object types", async () => {
    await expect(
      applyPendingOp(
        { supabase: {} } as never,
        makeOp({ object_type: "bogus" as never })
      )
    ).rejects.toThrow(/Unsupported pending op target/);
  });
});
