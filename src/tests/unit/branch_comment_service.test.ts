import { describe, it, expect } from "vitest";

/**
 * Unit tests for `branch_comment_service` — the per-diff-row comment
 * thread storage used by the branch review workflow.
 *
 * Invariants we cover:
 *   1. `createComment` persists the tuple and returns the inserted
 *      row. Body is trimmed + validated.
 *   2. Replies must share `(branch_id, object_type, object_id)` with
 *      their parent; grafting is rejected.
 *   3. `listCommentsForObject` filters down to one (type, id) pair.
 *   4. `resolveComment` stamps resolved=true + resolved_by +
 *      resolved_at.
 *   5. `deleteComment` enforces author-only: a non-author is
 *      rejected at the service layer.
 *   6. `countUnresolvedComments` returns 0 when all are resolved, N
 *      otherwise.
 */

import {
  createComment,
  listCommentsForObject,
  resolveComment,
  deleteComment,
  countUnresolvedComments,
} from "@/server/services/branch_comment_service";

const BRANCH = "branch-1";
const AUTHOR = "user-1";
const OTHER = "user-2";

interface Call {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  filters: Array<{ col: string; val: unknown }>;
  payload?: Record<string, unknown>;
}

function makeSupabase(opts: {
  parentComment?: {
    branch_id: string;
    object_type: string;
    object_id: string;
    parent_comment_id: string | null;
  } | null;
  insertedRow?: Record<string, unknown>;
  updatedRow?: Record<string, unknown>;
  commentToDelete?: { id: string; author_id: string } | null;
  listRows?: Array<Record<string, unknown>>;
  unresolvedRows?: Array<{ id: string }>;
}) {
  const calls: Call[] = [];
  function builder(table: string) {
    let op: Call["op"] = "select";
    const filters: Call["filters"] = [];
    let payload: Record<string, unknown> | undefined;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      filters.push({ col, val });
      return b;
    };
    b.order = () => b;
    b.insert = (p: Record<string, unknown>) => {
      op = "insert";
      payload = p;
      return b;
    };
    b.update = (p: Record<string, unknown>) => {
      op = "update";
      payload = p;
      return b;
    };
    b.delete = () => {
      op = "delete";
      return b;
    };
    b.single = async () => {
      calls.push({ table, op, filters: [...filters], payload });
      if (op === "insert") {
        return {
          data:
            opts.insertedRow ?? {
              id: "c-new",
              branch_id: BRANCH,
              object_type: "note",
              object_id: "n1",
              parent_comment_id: null,
              author_id: AUTHOR,
              body: "hi",
              resolved: false,
              resolved_by: null,
              resolved_at: null,
              created_at: "",
              updated_at: "",
            },
          error: null,
        };
      }
      if (op === "update") {
        return {
          data:
            opts.updatedRow ?? {
              id: "c-1",
              branch_id: BRANCH,
              object_type: "note",
              object_id: "n1",
              parent_comment_id: null,
              author_id: AUTHOR,
              body: "hi",
              resolved: true,
              resolved_by: AUTHOR,
              resolved_at: "",
              created_at: "",
              updated_at: "",
            },
          error: null,
        };
      }
      return { data: null, error: null };
    };
    b.maybeSingle = async () => {
      calls.push({ table, op, filters: [...filters], payload });
      if (op === "select" && table === "branch_comments") {
        if (opts.parentComment !== undefined) {
          return { data: opts.parentComment, error: null };
        }
        if (opts.commentToDelete !== undefined) {
          return { data: opts.commentToDelete, error: null };
        }
      }
      return { data: null, error: null };
    };
    b.then = async (
      resolve: (v: { data: unknown[]; error: null }) => void
    ) => {
      calls.push({ table, op, filters: [...filters], payload });
      if (op === "delete") {
        resolve({ data: [], error: null });
        return;
      }
      const hasResolvedFalseFilter = filters.some(
        (f) => f.col === "resolved" && f.val === false
      );
      if (hasResolvedFalseFilter) {
        resolve({ data: opts.unresolvedRows ?? [], error: null });
        return;
      }
      resolve({ data: opts.listRows ?? [], error: null });
    };
    return b;
  }
  return { supabase: { from: builder } as never, calls };
}

describe("createComment", () => {
  it("persists a top-level comment", async () => {
    const { supabase, calls } = makeSupabase({});
    const out = await createComment(supabase, {
      branchId: BRANCH,
      objectType: "note",
      objectId: "n1",
      authorId: AUTHOR,
      body: "needs tests",
    });
    expect(out.id).toBe("c-new");
    const insert = calls.find((c) => c.op === "insert");
    expect(insert!.payload).toMatchObject({
      branch_id: BRANCH,
      object_type: "note",
      object_id: "n1",
      author_id: AUTHOR,
      body: "needs tests",
    });
  });

  it("rejects empty body", async () => {
    const { supabase } = makeSupabase({});
    await expect(
      createComment(supabase, {
        branchId: BRANCH,
        objectType: "note",
        objectId: "n1",
        authorId: AUTHOR,
        body: "   ",
      })
    ).rejects.toThrow(/body is required/i);
  });

  it("rejects reply whose parent is on a different thread", async () => {
    const { supabase } = makeSupabase({
      parentComment: {
        branch_id: BRANCH,
        object_type: "file",
        object_id: "different",
        parent_comment_id: null,
      },
    });
    await expect(
      createComment(supabase, {
        branchId: BRANCH,
        objectType: "note",
        objectId: "n1",
        parentCommentId: "parent-1",
        authorId: AUTHOR,
        body: "hi",
      })
    ).rejects.toThrow(/different branch\/object thread/i);
  });

  it("accepts reply on same thread", async () => {
    const { supabase, calls } = makeSupabase({
      parentComment: {
        branch_id: BRANCH,
        object_type: "note",
        object_id: "n1",
        parent_comment_id: null,
      },
    });
    await createComment(supabase, {
      branchId: BRANCH,
      objectType: "note",
      objectId: "n1",
      parentCommentId: "parent-1",
      authorId: AUTHOR,
      body: "agreed",
    });
    const insert = calls.find((c) => c.op === "insert");
    expect(insert!.payload).toMatchObject({
      parent_comment_id: "parent-1",
    });
  });
});

describe("listCommentsForObject", () => {
  it("filters by branch + objectType + objectId", async () => {
    const rows = [
      { id: "c1", branch_id: BRANCH, object_type: "note", object_id: "n1" },
    ];
    const { supabase, calls } = makeSupabase({ listRows: rows });
    const out = await listCommentsForObject(supabase, BRANCH, "note", "n1");
    expect(out).toHaveLength(1);
    const select = calls.find((c) => c.op === "select");
    const filterCols = select!.filters.map((f) => f.col);
    expect(filterCols).toContain("branch_id");
    expect(filterCols).toContain("object_type");
    expect(filterCols).toContain("object_id");
  });
});

describe("resolveComment", () => {
  it("sets resolved=true with resolver + timestamp", async () => {
    const { supabase, calls } = makeSupabase({});
    await resolveComment(supabase, "c-1", AUTHOR);
    const update = calls.find((c) => c.op === "update");
    expect(update!.payload).toHaveProperty("resolved", true);
    expect(update!.payload).toHaveProperty("resolved_by", AUTHOR);
    expect(update!.payload).toHaveProperty("resolved_at");
  });
});

describe("deleteComment", () => {
  it("author can delete", async () => {
    const { supabase, calls } = makeSupabase({
      commentToDelete: { id: "c-1", author_id: AUTHOR },
    });
    await deleteComment(supabase, "c-1", AUTHOR);
    const del = calls.find((c) => c.op === "delete");
    expect(del).toBeDefined();
  });

  it("non-author is rejected", async () => {
    const { supabase } = makeSupabase({
      commentToDelete: { id: "c-1", author_id: AUTHOR },
    });
    await expect(
      deleteComment(supabase, "c-1", OTHER)
    ).rejects.toThrow(/author can delete/i);
  });
});

describe("countUnresolvedComments", () => {
  it("returns count of unresolved rows", async () => {
    const { supabase } = makeSupabase({
      unresolvedRows: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
    });
    const n = await countUnresolvedComments(supabase, BRANCH);
    expect(n).toBe(3);
  });

  it("returns 0 when all resolved", async () => {
    const { supabase } = makeSupabase({ unresolvedRows: [] });
    const n = await countUnresolvedComments(supabase, BRANCH);
    expect(n).toBe(0);
  });
});
