import { describe, it, expect } from "vitest";

/**
 * Unit tests for the shared `runLifecycleOnBranchOrMain` helper that
 * closes the main-mutating lifecycle leaks on agents, files, and
 * skills. The invariants we care about:
 *
 *   1. When no `branchId` is passed, `appliedToMain` is true and the
 *      helper issued no writes (caller runs the main path).
 *   2. On a branch, `archive` records a `branch_pending_ops` upsert
 *      with op_type=archive; no write lands on the canonical table.
 *   3. On a branch, `trash` records a pending op with op_type=trash.
 *   4. On a branch, `unarchive` DROPS any prior archive op for the
 *      target (swap semantics) and does NOT record a positive
 *      unarchive op.
 *   5. On a branch, `restore_lifecycle` DROPS any prior trash op.
 */

import { runLifecycleOnBranchOrMain } from "@/server/services/lifecycle_branch_router";

const BRANCH = "branch-x";
const ACTOR = "user-1";

interface Call {
  table: string;
  op: "upsert" | "delete" | "update" | "select";
  args?: Record<string, unknown>;
  filters: Array<{ col: string; val: unknown }>;
}

function makeSupabase() {
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
    b.is = (col: string, val: unknown) => {
      filters.push({ col, val });
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
    b.single = async () => {
      calls.push({ table, op, args, filters });
      return { data: { id: "op-1" }, error: null };
    };
    b.maybeSingle = async () => {
      calls.push({ table, op, args, filters });
      return { data: null, error: null };
    };
    b.then = async (resolve: (v: { data: unknown[]; error: null }) => void) => {
      calls.push({ table, op, args, filters });
      resolve({ data: [], error: null });
    };
    return b;
  }
  return { supabase: { from: (t: string) => builder(t) } as never, calls };
}

describe("runLifecycleOnBranchOrMain", () => {
  it("returns appliedToMain=true and issues no writes when branchId is null", async () => {
    const { supabase, calls } = makeSupabase();
    const res = await runLifecycleOnBranchOrMain({
      supabase,
      branchId: null,
      actorId: ACTOR,
      objectType: "agent",
      objectId: "agent-1",
      op: "archive",
    });
    expect(res.appliedToMain).toBe(true);
    expect(calls).toEqual([]);
  });

  it("archive on a branch upserts a pending op and leaves main alone", async () => {
    const { supabase, calls } = makeSupabase();
    const res = await runLifecycleOnBranchOrMain({
      supabase,
      branchId: BRANCH,
      actorId: ACTOR,
      objectType: "agent",
      objectId: "agent-1",
      op: "archive",
    });
    expect(res.appliedToMain).toBe(false);
    const upsert = calls.find((c) => c.op === "upsert");
    expect(upsert?.table).toBe("branch_pending_ops");
    const payload = (upsert?.args as { payload: Record<string, unknown> }).payload;
    expect(payload).toMatchObject({
      branch_id: BRANCH,
      op_type: "archive",
      object_type: "agent",
      object_id: "agent-1",
      actor_id: ACTOR,
    });
    expect(calls.some((c) => c.table === "agents")).toBe(false);
  });

  it("trash on a branch records a pending op with op_type=trash", async () => {
    const { supabase, calls } = makeSupabase();
    await runLifecycleOnBranchOrMain({
      supabase,
      branchId: BRANCH,
      actorId: ACTOR,
      objectType: "file",
      objectId: "file-1",
      op: "trash",
    });
    const upsert = calls.find((c) => c.op === "upsert");
    expect(upsert?.table).toBe("branch_pending_ops");
    const payload = (upsert?.args as { payload: Record<string, unknown> }).payload;
    expect(payload.op_type).toBe("trash");
    expect(calls.some((c) => c.table === "files")).toBe(false);
  });

  it("unarchive drops the matching archive op and does not record a positive op", async () => {
    const { supabase, calls } = makeSupabase();
    await runLifecycleOnBranchOrMain({
      supabase,
      branchId: BRANCH,
      actorId: ACTOR,
      objectType: "agent",
      objectId: "agent-1",
      op: "unarchive",
    });
    const del = calls.find((c) => c.op === "delete");
    expect(del?.table).toBe("branch_pending_ops");
    expect(del?.filters).toContainEqual({ col: "branch_id", val: BRANCH });
    expect(del?.filters).toContainEqual({ col: "object_id", val: "agent-1" });
    expect(del?.filters).toContainEqual({ col: "op_type", val: "archive" });
    // No positive upsert — the drop cancels the prior intent.
    expect(calls.find((c) => c.op === "upsert")).toBeUndefined();
  });

  it("restore_lifecycle drops the matching trash op", async () => {
    const { supabase, calls } = makeSupabase();
    await runLifecycleOnBranchOrMain({
      supabase,
      branchId: BRANCH,
      actorId: ACTOR,
      objectType: "skill",
      objectId: "skill-1",
      op: "restore_lifecycle",
    });
    const del = calls.find((c) => c.op === "delete");
    expect(del?.table).toBe("branch_pending_ops");
    expect(del?.filters).toContainEqual({ col: "op_type", val: "trash" });
    expect(calls.find((c) => c.op === "upsert")).toBeUndefined();
  });
});
