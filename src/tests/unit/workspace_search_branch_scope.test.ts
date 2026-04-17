import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tests for the `branch_scope` parameter on `searchWorkspace`.
 *
 * Verifies that the service attaches the correct branch_id predicate
 * to each per-table query builder based on the scope the caller asked
 * for:
 *
 *   - main_only          → `.is("branch_id", null)`
 *   - main_plus_branch   → `.or("branch_id.is.null,branch_id.eq.<id>")`
 *   - branch_only        → `.eq("branch_id", <id>)`
 *
 * The mock is a structural supabase-double (same shape used in
 * branch_scoped_notes.test.ts): each query builder remembers the
 * branch predicate it saw, filters a row array in-memory, and the
 * test inspects the resulting hits.
 */

import { searchWorkspace } from "@/server/services/workspace_search_service";

type Row = Record<string, unknown>;

interface BranchPredicate {
  kind: "is_null" | "eq" | "or_main_branch";
  branchId?: string;
}

function makeMockSupabase(tableRows: Record<string, Row[]>) {
  // Capture the branch predicate the service applied to each `from()`
  // query so tests can assert on it.
  const predicates: Record<string, BranchPredicate | null> = {};

  const from = (table: string) => {
    const rows = tableRows[table] ?? [];
    let branchPred: BranchPredicate | null = null;
    // Second .or() call carries the ilike search expression; we ignore
    // it for predicate inspection but it still must chain.
    let sawBranchOr = false;

    const query: Record<string, unknown> = {};
    Object.assign(query, {
      select: () => query,
      eq: (col: string, v: unknown) => {
        if (col === "branch_id") {
          branchPred = { kind: "eq", branchId: String(v) };
        }
        return query;
      },
      neq: () => query,
      is: (col: string, v: unknown) => {
        if (col === "branch_id" && v === null) {
          branchPred = { kind: "is_null" };
        }
        return query;
      },
      or: (expr: string) => {
        if (!sawBranchOr && /^branch_id\.is\.null,branch_id\.eq\./.test(expr)) {
          const m = expr.match(/branch_id\.eq\.([^,)]+)/);
          branchPred = {
            kind: "or_main_branch",
            branchId: m?.[1],
          };
          sawBranchOr = true;
        }
        return query;
      },
      limit: () => query,
      then: <T>(
        onFulfilled: (v: { data: Row[]; error: null }) => T
      ): Promise<T> => {
        predicates[table] = branchPred;
        const pred = branchPred;
        const filtered = rows.filter((r) => {
          // boxes is workspace-scoped; no branch predicate applied.
          if (pred === null) return true;
          if (pred.kind === "is_null") return r.branch_id === null;
          if (pred.kind === "eq") return r.branch_id === pred.branchId;
          if (pred.kind === "or_main_branch") {
            return r.branch_id === null || r.branch_id === pred.branchId;
          }
          return true;
        });
        return Promise.resolve(onFulfilled({ data: filtered, error: null }));
      },
    });
    return query;
  };

  return {
    client: { from } as unknown as SupabaseClient,
    predicates,
  };
}

const WS = "ws-1";
const BRANCH = "branch-abc";

const base = {
  workspace_id: WS,
  box_id: null,
  path_cache: null,
  status: "active",
  updated_at: "2026-04-17T00:00:00Z",
};

const mainNote = {
  ...base,
  id: "n-main",
  title: "alpha on main",
  summary: null,
  markdown_content: null,
  branch_id: null,
};
const branchNote = {
  ...base,
  id: "n-branch",
  title: "alpha on branch",
  summary: null,
  markdown_content: null,
  branch_id: BRANCH,
};
const otherBranchNote = {
  ...base,
  id: "n-other",
  title: "alpha on other branch",
  summary: null,
  markdown_content: null,
  branch_id: "branch-zzz",
};

// boxMap is provided explicitly to avoid the loadBoxMap round-trip.
const boxMap = new Map<string, string>();

describe("searchWorkspace branch_scope", () => {
  it("main_only filters notes to branch_id IS NULL", async () => {
    const mock = makeMockSupabase({
      notes: [mainNote, branchNote, otherBranchNote],
    });
    const hits = await searchWorkspace(mock.client, WS, "alpha", {
      boxMap,
      branchScope: "main_only",
      branchId: BRANCH, // should be ignored for scope purposes
    });
    const noteHits = hits.filter((h) => h.objectType === "note");
    expect(noteHits.map((h) => h.id).sort()).toEqual(["n-main"]);
    expect(mock.predicates.notes).toEqual({ kind: "is_null" });
  });

  it("branch_only filters notes to branch_id = <uuid>", async () => {
    const mock = makeMockSupabase({
      notes: [mainNote, branchNote, otherBranchNote],
    });
    const hits = await searchWorkspace(mock.client, WS, "alpha", {
      boxMap,
      branchScope: "branch_only",
      branchId: BRANCH,
    });
    const noteHits = hits.filter((h) => h.objectType === "note");
    expect(noteHits.map((h) => h.id).sort()).toEqual(["n-branch"]);
    expect(mock.predicates.notes).toEqual({ kind: "eq", branchId: BRANCH });
  });

  it("main_plus_branch returns both main and active-branch notes", async () => {
    const mock = makeMockSupabase({
      notes: [mainNote, branchNote, otherBranchNote],
    });
    const hits = await searchWorkspace(mock.client, WS, "alpha", {
      boxMap,
      branchScope: "main_plus_branch",
      branchId: BRANCH,
    });
    const noteHits = hits.filter((h) => h.objectType === "note");
    expect(noteHits.map((h) => h.id).sort()).toEqual(["n-branch", "n-main"]);
    expect(mock.predicates.notes).toEqual({
      kind: "or_main_branch",
      branchId: BRANCH,
    });
  });
});
