import { describe, it, expect } from "vitest";

/**
 * Tests for branch-scoped note creation + reads.
 *
 * Mirrors the files/object_links shape in
 * `branch_local_structural.test.ts`. Invariants:
 *
 *   1. `listNotesByBox` with no branchId returns only main rows.
 *   2. `listNotesByBox` with a branchId returns main + that branch's
 *      draft notes, hiding other branches' drafts.
 *   3. Branch-scoped deletes on discard don't affect main rows.
 */

import { listNotesByBox } from "@/server/repositories/note_repository";

function makeMockSupabase(rows: Array<Record<string, unknown>>) {
  const filters: Record<string, unknown> = {};
  let orFilter: string | null = null;
  const query = {
    select: () => query,
    eq: (col: string, v: unknown) => {
      filters[col] = v;
      return query;
    },
    neq: () => query,
    is: (col: string, v: unknown) => {
      filters[`${col}:is`] = v;
      return query;
    },
    or: (expr: string) => {
      orFilter = expr;
      return query;
    },
    range: () => query,
    order: () => query,
    then: async (resolve: (v: { data: unknown[]; error: null }) => void) => {
      const out = rows.filter((r) => {
        if (filters["branch_id:is"] === null) return r.branch_id === null;
        if (orFilter) {
          const match = orFilter.match(/branch_id\.eq\.([^,]+)/);
          const branchId = match?.[1];
          return r.branch_id === null || r.branch_id === branchId;
        }
        return true;
      });
      resolve({ data: out, error: null });
    },
  };
  return { from: () => query } as never;
}

describe("listNotesByBox branch filter", () => {
  const mainNote = { id: "n-main", branch_id: null, box_id: "b", title: "main" };
  const draftNoteOnBranch = { id: "n-draft", branch_id: "branch-1", box_id: "b", title: "draft" };
  const draftNoteOnOtherBranch = { id: "n-other", branch_id: "branch-2", box_id: "b", title: "other" };

  it("returns only main rows when no branchId is passed", async () => {
    const sb = makeMockSupabase([mainNote, draftNoteOnBranch, draftNoteOnOtherBranch]);
    const result = await listNotesByBox(sb, "b");
    expect(result.map((r) => r.id)).toEqual(["n-main"]);
  });

  it("returns main + active-branch rows when branchId is passed", async () => {
    const sb = makeMockSupabase([mainNote, draftNoteOnBranch, draftNoteOnOtherBranch]);
    const result = await listNotesByBox(sb, "b", { branchId: "branch-1" });
    expect(result.map((r) => r.id).sort()).toEqual(["n-draft", "n-main"]);
  });

  it("still hides other branches' drafts when a branch is active", async () => {
    const sb = makeMockSupabase([mainNote, draftNoteOnBranch, draftNoteOnOtherBranch]);
    const result = await listNotesByBox(sb, "b", { branchId: "branch-1" });
    expect(result.find((r) => r.id === "n-other")).toBeUndefined();
  });
});
