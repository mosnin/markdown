import { describe, it, expect, vi } from "vitest";

/**
 * Tests for branch-local structural creation (files + object_links).
 *
 * Defends the invariants that let branches own new rows without
 * leaking to main:
 *
 *   1. `listFilesByBox` with no branchId filters out rows whose
 *      `branch_id` is non-null (main-only view).
 *   2. `listFilesByBox` with an active branchId returns rows with
 *      `branch_id IS NULL` OR `branch_id = <branch>`; other
 *      branches' drafts stay invisible.
 *   3. `getLinksForObject` filters `object_links.branch_id` the
 *      same way.
 *   4. The filter short-circuits when no branchId is set (no DB
 *      work beyond the existing read).
 */

import { listFilesByBox } from "@/server/repositories/file_repository";
import { getLinksForObject } from "@/server/services/object_link_service";

// ─── File list filter tests ──────────────────────────────────────────────────

function makeFilesMockSupabase(rows: Array<Record<string, unknown>>) {
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
        // Main-only read: branch_id:is === null.
        if (filters["branch_id:is"] === null) return r.branch_id === null;
        // Branch read: .or("branch_id.is.null,branch_id.eq.<id>").
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

describe("listFilesByBox branch filter", () => {
  const mainFile = { id: "f-main", branch_id: null, box_id: "b", name: "main.py" };
  const draftFileOnBranch = { id: "f-draft", branch_id: "branch-1", box_id: "b", name: "draft.py" };
  const draftFileOnOtherBranch = { id: "f-other", branch_id: "branch-2", box_id: "b", name: "other.py" };

  it("returns only main rows when no branchId is passed", async () => {
    const sb = makeFilesMockSupabase([mainFile, draftFileOnBranch, draftFileOnOtherBranch]);
    const result = await listFilesByBox(sb, "b");
    expect(result.map((r) => r.id)).toEqual(["f-main"]);
  });

  it("returns main + active-branch rows when branchId is passed", async () => {
    const sb = makeFilesMockSupabase([mainFile, draftFileOnBranch, draftFileOnOtherBranch]);
    const result = await listFilesByBox(sb, "b", { branchId: "branch-1" });
    expect(result.map((r) => r.id).sort()).toEqual(["f-draft", "f-main"]);
  });

  it("still hides other branches' drafts when a branch is active", async () => {
    const sb = makeFilesMockSupabase([mainFile, draftFileOnBranch, draftFileOnOtherBranch]);
    const result = await listFilesByBox(sb, "b", { branchId: "branch-1" });
    expect(result.find((r) => r.id === "f-other")).toBeUndefined();
  });
});

// ─── object_links branch filter tests ────────────────────────────────────────

vi.mock("@/server/repositories/object_link_repository", () => ({
  getObjectLinksForSource: vi.fn(),
  getObjectLinksForTarget: vi.fn(),
}));

import * as linkRepo from "@/server/repositories/object_link_repository";
import type { ObjectLink } from "@/server/domain/types/object_link";

function stubLink(id: string, branchId: string | null): ObjectLink {
  return {
    id,
    workspace_id: "w",
    source_object_type: "agent",
    source_object_id: "a-1",
    target_object_type: "skill",
    target_object_id: "s-1",
    relationship_type: "depends_on",
    relationship_note: null,
    branch_id: branchId,
    created_at: new Date().toISOString(),
  };
}

describe("getLinksForObject branch filter", () => {
  const links = [
    stubLink("l-main", null),
    stubLink("l-draft", "branch-1"),
    stubLink("l-other", "branch-2"),
  ];
  const supabase = {} as never;

  it("returns only main links when no branchId is passed", async () => {
    vi.mocked(linkRepo.getObjectLinksForSource).mockResolvedValueOnce(links);
    vi.mocked(linkRepo.getObjectLinksForTarget).mockResolvedValueOnce([]);
    const result = await getLinksForObject(supabase, "w", "agent", "a-1");
    expect(result.outgoing.map((l) => l.id)).toEqual(["l-main"]);
  });

  it("returns main + branch-specific links when branchId is active", async () => {
    vi.mocked(linkRepo.getObjectLinksForSource).mockResolvedValueOnce(links);
    vi.mocked(linkRepo.getObjectLinksForTarget).mockResolvedValueOnce([]);
    const result = await getLinksForObject(supabase, "w", "agent", "a-1", { branchId: "branch-1" });
    expect(result.outgoing.map((l) => l.id).sort()).toEqual(["l-draft", "l-main"]);
  });

  it("still hides other branches' draft links when one branch is active", async () => {
    vi.mocked(linkRepo.getObjectLinksForSource).mockResolvedValueOnce(links);
    vi.mocked(linkRepo.getObjectLinksForTarget).mockResolvedValueOnce([]);
    const result = await getLinksForObject(supabase, "w", "agent", "a-1", { branchId: "branch-1" });
    expect(result.outgoing.find((l) => l.id === "l-other")).toBeUndefined();
  });

  it("applies the same filter to incoming links", async () => {
    vi.mocked(linkRepo.getObjectLinksForSource).mockResolvedValueOnce([]);
    vi.mocked(linkRepo.getObjectLinksForTarget).mockResolvedValueOnce(links);
    const result = await getLinksForObject(supabase, "w", "skill", "s-1", { branchId: "branch-1" });
    expect(result.incoming.map((l) => l.id).sort()).toEqual(["l-draft", "l-main"]);
  });
});
