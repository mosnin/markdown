import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for cherry-pick / partial promote. Exercise
 * `promoteBranch` with the new `selectedObjects` option and verify:
 *
 *   1. Only the selected heads / overlays / pending ops / branch-local
 *      rows are promoted.
 *   2. Branch status stays 'open' when any unpromoted work remains.
 *   3. Branch status flips to 'promoted' when the selection covers
 *      every remaining artifact.
 *   4. Pending ops on unselected objects are preserved (not applied).
 *   5. The change_set's origin is 'branch_promotion_partial'.
 *   6. The change_set metadata records the selected object list so
 *      rollback can target the exact subset.
 */

const openedChangeSets: Array<{ origin: string; metadata: Record<string, unknown> }> = [];

vi.mock("@/server/services/change_set_service", async () => ({
  openChangeSet: vi.fn().mockImplementation(async (_sb: unknown, input: { origin: string; metadata: Record<string, unknown> }) => {
    openedChangeSets.push({ origin: input.origin, metadata: input.metadata ?? {} });
    return { id: "cs-partial", status: "open" };
  }),
  commitChangeSet: vi.fn().mockResolvedValue(undefined),
  abortChangeSet: vi.fn().mockResolvedValue(undefined),
  recordChangeSetItem: vi.fn().mockResolvedValue(undefined),
}));

const mockCountUnresolvedComments = vi.fn();
vi.mock("@/server/services/branch_comment_service", () => ({
  countUnresolvedComments: (...args: unknown[]) => mockCountUnresolvedComments(...args),
}));

const mockPromoteBoxOverlays = vi.fn();
const mockPromoteFolderOverrides = vi.fn();
const mockPromotePlacementOverrides = vi.fn();
const mockListPendingOps = vi.fn();
const mockApplyPendingOp = vi.fn();

vi.mock("@/server/services/box_branch_metadata_service", () => ({
  promoteBoxOverlays: (...args: unknown[]) => mockPromoteBoxOverlays(...args),
}));
vi.mock("@/server/services/folder_branch_service", () => ({
  promoteFolderOverrides: (...args: unknown[]) => mockPromoteFolderOverrides(...args),
}));
vi.mock("@/server/services/placement_branch_service", () => ({
  promotePlacementOverrides: (...args: unknown[]) => mockPromotePlacementOverrides(...args),
}));
vi.mock("@/server/services/pending_op_service", () => ({
  listPendingOps: (...args: unknown[]) => mockListPendingOps(...args),
  applyPendingOp: (...args: unknown[]) => mockApplyPendingOp(...args),
}));

import { promoteBranch } from "@/server/services/branch_service";

const WS = "ws-partial";
const UID = "u-partial";
const BID = "b-partial";

/**
 * Build a Supabase-like mock for the partial-promote path. The
 * shape mirrors the existing `branch_promote_*` tests. Options:
 *
 *   - heads: branch_heads rows the branch has
 *   - unresolvedCommentCount: comment gate override
 *   - remainingAfter: count returned by countUnpromotedForBranch()'s
 *     `{ count: "exact", head: true }` reads. When nonzero, the
 *     branch should stay `open`; zero flips it to `promoted`.
 */
function makeMock(opts: {
  heads?: Array<{ id: string; object_type: string; object_id: string; version_id: string }>;
  remainingAfter?: number;
}) {
  const heads = opts.heads ?? [];
  const remainingPerTable = opts.remainingAfter ?? 0;
  const updates: Array<{ table: string; patch: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const changeSetItems: Array<{
    operation: string;
    object_type: string;
    object_id: string;
  }> = [];
  // Capture applied notes to verify unselected heads were skipped.
  const appliedNoteUpdates: Array<{ id: string; new_version_id: string }> = [];

  function fromFn(table: string) {
    const filters: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    b.select = (_cols?: string, opts2?: { count?: string; head?: boolean }) => {
      const s: Record<string, unknown> = {};
      const countMode = opts2?.head === true;
      s.eq = (c: string, v: unknown) => {
        filters[c] = v;
        return s;
      };
      s.in = () => s;
      s.is = () => s;
      s.order = () => s;
      s.maybeSingle = async () => {
        if (table === "draft_branches") {
          return {
            data: {
              id: BID,
              workspace_id: WS,
              name: "cherry",
              status: "open",
              review_status: "draft",
            },
            error: null,
          };
        }
        if (table === "notes") {
          // object lookup by note id
          return {
            data: {
              id: filters.id,
              current_version_id: `v-main-${filters.id}`,
              title: "t",
              markdown_content: "m",
              content_bytes: 1,
              summary: null,
            },
            error: null,
          };
        }
        if (table === "note_versions") {
          return {
            data: {
              id: filters.id,
              title: "t2",
              markdown_content: "m2",
              content_bytes: 2,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      };
      s.single = s.maybeSingle;
      s.then = async (r: (v: { data: unknown; error: null; count?: number }) => void) => {
        if (countMode) {
          // Partial-promote status flip probe. Returns the "how many
          // rows remain on the branch" count per table.
          r({ data: null, error: null, count: remainingPerTable });
          return;
        }
        if (table === "branch_heads") {
          r({ data: heads.map((h) => ({ ...h, branch_id: BID })), error: null });
        } else if (table === "branch_comments") {
          r({ data: [], error: null });
        } else {
          r({ data: [], error: null });
        }
      };
      return s;
    };
    b.update = (patch: Record<string, unknown>) => {
      const cf: Record<string, unknown> = {};
      const u: Record<string, unknown> = {};
      u.eq = (c: string, v: unknown) => {
        cf[c] = v;
        return u;
      };
      u.select = () => {
        updates.push({ table, patch, filters: { ...cf } });
        if (table === "draft_branches" && cf.status === "open" && patch.status === "promoting") {
          return Promise.resolve({ data: [{ id: BID }], error: null });
        }
        return Promise.resolve({ data: [{ id: "x" }], error: null });
      };
      u.then = async (r: (v: { error: null }) => void) => {
        updates.push({ table, patch, filters: { ...cf } });
        if (table === "notes" && typeof cf.id === "string") {
          appliedNoteUpdates.push({ id: cf.id as string, new_version_id: patch.current_version_id as string });
        }
        r({ error: null });
      };
      return u;
    };
    b.delete = () => {
      const d: Record<string, unknown> = {};
      d.eq = () => d;
      d.then = async (r: (v: { error: null }) => void) => r({ error: null });
      return d;
    };
    b.insert = () => ({
      select: () => ({ single: async () => ({ data: {}, error: null }) }),
    });
    b.upsert = () => ({
      select: () => ({ single: async () => ({ data: {}, error: null }) }),
    });
    b.eq = (c: string, v: unknown) => {
      filters[c] = v;
      return b;
    };
    return b;
  }

  return {
    client: { from: fromFn } as never,
    updates,
    changeSetItems,
    appliedNoteUpdates,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  openedChangeSets.length = 0;
  mockCountUnresolvedComments.mockResolvedValue(0);
  mockPromoteBoxOverlays.mockResolvedValue([]);
  mockPromoteFolderOverrides.mockResolvedValue([]);
  mockPromotePlacementOverrides.mockResolvedValue([]);
  mockListPendingOps.mockResolvedValue([]);
  mockApplyPendingOp.mockResolvedValue({ before: {}, after: {} });
});

describe("promoteBranch — partial promote selection filter", () => {
  it("promotes only the selected head and skips the unselected one", async () => {
    const heads = [
      { id: "h1", object_type: "note", object_id: "n1", version_id: "v1" },
      { id: "h2", object_type: "note", object_id: "n2", version_id: "v2" },
    ];
    const { client, appliedNoteUpdates } = makeMock({
      heads,
      remainingAfter: 1, // something still remains -> branch stays open
    });

    const r = await promoteBranch(client, WS, UID, BID, {
      selectedObjects: [{ objectType: "note", objectId: "n1" }],
    });
    expect(r.branchId).toBe(BID);
    expect(r.promotedObjects.map((p) => p.object_id)).toEqual(["n1"]);
    // Only n1 should have had its canonical row advanced.
    expect(appliedNoteUpdates.map((u) => u.id)).toContain("n1");
    expect(appliedNoteUpdates.map((u) => u.id)).not.toContain("n2");
  });

  it("uses change_set origin 'branch_promotion_partial' with metadata.promoted_objects", async () => {
    const heads = [
      { id: "h1", object_type: "note", object_id: "n1", version_id: "v1" },
    ];
    const { client } = makeMock({ heads, remainingAfter: 0 });
    await promoteBranch(client, WS, UID, BID, {
      selectedObjects: [{ objectType: "note", objectId: "n1" }],
    });
    expect(openedChangeSets).toHaveLength(1);
    expect(openedChangeSets[0].origin).toBe("branch_promotion_partial");
    const promoted = openedChangeSets[0].metadata.promoted_objects as Array<{
      object_type: string;
      object_id: string;
    }>;
    expect(promoted).toEqual([{ object_type: "note", object_id: "n1" }]);
  });

  it("full-promote path (no selection) uses origin 'branch_promotion'", async () => {
    const heads = [
      { id: "h1", object_type: "note", object_id: "n1", version_id: "v1" },
    ];
    const { client } = makeMock({ heads, remainingAfter: 0 });
    await promoteBranch(client, WS, UID, BID);
    expect(openedChangeSets[0].origin).toBe("branch_promotion");
    expect(openedChangeSets[0].metadata.promoted_objects).toBeUndefined();
  });

  it("keeps branch status='open' when unpromoted artifacts remain", async () => {
    const heads = [
      { id: "h1", object_type: "note", object_id: "n1", version_id: "v1" },
      { id: "h2", object_type: "note", object_id: "n2", version_id: "v2" },
    ];
    const { client, updates } = makeMock({
      heads,
      // Nonzero per-table → total across tables > 0 → branch stays open.
      remainingAfter: 1,
    });
    await promoteBranch(client, WS, UID, BID, {
      selectedObjects: [{ objectType: "note", objectId: "n1" }],
    });
    const finalFlips = updates.filter(
      (u) =>
        u.table === "draft_branches" &&
        u.filters.status === "promoting"
    );
    const promotedFlip = finalFlips.find(
      (u) => u.patch.status === "promoted"
    );
    const openFlip = finalFlips.find((u) => u.patch.status === "open");
    expect(promotedFlip).toBeUndefined();
    expect(openFlip).toBeDefined();
  });

  it("flips branch status='promoted' when the selection covers everything", async () => {
    const heads = [
      { id: "h1", object_type: "note", object_id: "n1", version_id: "v1" },
    ];
    const { client, updates } = makeMock({
      heads,
      remainingAfter: 0, // nothing left → branch flips to promoted
    });
    await promoteBranch(client, WS, UID, BID, {
      selectedObjects: [{ objectType: "note", objectId: "n1" }],
    });
    const promotedFlip = updates.find(
      (u) =>
        u.table === "draft_branches" &&
        u.patch.status === "promoted" &&
        u.filters.status === "promoting"
    );
    expect(promotedFlip).toBeDefined();
  });

  it("preserves pending ops on unselected objects (does not apply)", async () => {
    const heads = [
      { id: "h1", object_type: "note", object_id: "n1", version_id: "v1" },
    ];
    mockListPendingOps.mockResolvedValue([
      {
        id: "op1",
        branch_id: BID,
        op_type: "trash",
        object_type: "note",
        object_id: "n1",
        payload: {},
      },
      {
        id: "op2",
        branch_id: BID,
        op_type: "archive",
        object_type: "note",
        object_id: "n-other",
        payload: {},
      },
    ]);
    const { client } = makeMock({ heads, remainingAfter: 1 });
    await promoteBranch(client, WS, UID, BID, {
      selectedObjects: [{ objectType: "note", objectId: "n1" }],
    });
    // Only the n1 pending op is in the selection, so applyPendingOp
    // is called exactly once.
    expect(mockApplyPendingOp).toHaveBeenCalledTimes(1);
    expect(mockApplyPendingOp.mock.calls[0][1].object_id).toBe("n1");
  });

  it("rejects when selectedObjects is an empty array", async () => {
    const { client } = makeMock({
      heads: [
        { id: "h1", object_type: "note", object_id: "n1", version_id: "v1" },
      ],
      remainingAfter: 0,
    });
    await expect(
      promoteBranch(client, WS, UID, BID, { selectedObjects: [] })
    ).rejects.toThrow(/at least one selected/i);
  });

  it("passes a filter predicate to overlay helpers under partial promote", async () => {
    const heads = [
      { id: "h1", object_type: "note", object_id: "n1", version_id: "v1" },
    ];
    const { client } = makeMock({ heads, remainingAfter: 0 });
    await promoteBranch(client, WS, UID, BID, {
      selectedObjects: [{ objectType: "note", objectId: "n1" }],
    });
    // Each overlay helper receives (client, branchId, filter). The
    // filter is a function under partial promote; undefined under
    // full promote.
    expect(mockPromoteBoxOverlays).toHaveBeenCalled();
    expect(typeof mockPromoteBoxOverlays.mock.calls[0][2]).toBe("function");
    expect(typeof mockPromoteFolderOverrides.mock.calls[0][2]).toBe("function");
    expect(typeof mockPromotePlacementOverrides.mock.calls[0][2]).toBe("function");
  });

  it("full promote path does NOT pass filter predicates to overlay helpers", async () => {
    const heads = [
      { id: "h1", object_type: "note", object_id: "n1", version_id: "v1" },
    ];
    const { client } = makeMock({ heads, remainingAfter: 0 });
    await promoteBranch(client, WS, UID, BID);
    expect(mockPromoteBoxOverlays.mock.calls[0][2]).toBeUndefined();
    expect(mockPromoteFolderOverrides.mock.calls[0][2]).toBeUndefined();
    expect(mockPromotePlacementOverrides.mock.calls[0][2]).toBeUndefined();
  });
});

describe("promoteBranch — partial promote scoped comment gate", () => {
  it("cherry-pick succeeds when unresolved comments exist only on OTHER objects", async () => {
    // n1 is selected for promote; n2 has unresolved comments but is
    // NOT in the selection. The scoped comment gate should count zero
    // unresolved comments for the selection and let the promote through.
    const heads = [
      { id: "h1", object_type: "note", object_id: "n1", version_id: "v1" },
      { id: "h2", object_type: "note", object_id: "n2", version_id: "v2" },
    ];
    // countUnresolvedComments receives the objectFilter for partial
    // promote and should return 0 because n1 has no comments.
    mockCountUnresolvedComments.mockResolvedValue(0);
    const { client } = makeMock({ heads, remainingAfter: 1 });

    // Should succeed — the unresolved comments are on n2, not n1.
    const result = await promoteBranch(client, WS, UID, BID, {
      selectedObjects: [{ objectType: "note", objectId: "n1" }],
    });
    expect(result.promotedObjects.map((p) => p.object_id)).toEqual(["n1"]);

    // Verify countUnresolvedComments was called with the objectFilter
    // scoped to the selection (n1 only).
    expect(mockCountUnresolvedComments).toHaveBeenCalledTimes(1);
    const filterArg = mockCountUnresolvedComments.mock.calls[0][2];
    expect(filterArg).toEqual([{ objectType: "note", objectId: "n1" }]);
  });

  it("cherry-pick is blocked when the SELECTED object has unresolved comments", async () => {
    const heads = [
      { id: "h1", object_type: "note", object_id: "n1", version_id: "v1" },
    ];
    // The scoped gate finds 1 unresolved comment on the selected n1.
    mockCountUnresolvedComments.mockResolvedValue(1);
    const { client } = makeMock({ heads, remainingAfter: 0 });

    await expect(
      promoteBranch(client, WS, UID, BID, {
        selectedObjects: [{ objectType: "note", objectId: "n1" }],
      })
    ).rejects.toThrow(/unresolved comment/i);
  });

  it("full promote does NOT pass objectFilter to countUnresolvedComments", async () => {
    const heads = [
      { id: "h1", object_type: "note", object_id: "n1", version_id: "v1" },
    ];
    mockCountUnresolvedComments.mockResolvedValue(0);
    const { client } = makeMock({ heads, remainingAfter: 0 });
    await promoteBranch(client, WS, UID, BID);

    expect(mockCountUnresolvedComments).toHaveBeenCalledTimes(1);
    // Full promote: no objectFilter (second arg after branchId should
    // be undefined).
    expect(mockCountUnresolvedComments.mock.calls[0][2]).toBeUndefined();
  });
});

/**
 * Rollback verification: the existing rollback service already
 * uses `restoreFromChangeSet`, which walks change_set_items blindly.
 * The partial-promote origin list now includes the new value so
 * rollback finds the right change set even when the branch was
 * partially promoted before a second partial / full promote.
 *
 * This check is structural (does the query shape accept both
 * origins?) rather than an end-to-end rollback — that's covered by
 * the existing branch_rollback tests.
 */
describe("branch_rollback_service — origin lookup covers partial promote", () => {
  it("queries for both 'branch_promotion' and 'branch_promotion_partial'", async () => {
    const seenInValues: unknown[] = [];
    const mockChangeSets = [
      {
        id: "cs-latest-partial",
        origin: "branch_promotion_partial",
        status: "committed",
        metadata: { branch_id: BID },
        created_at: "2026-04-17T00:00:00Z",
      },
      {
        id: "cs-older-full",
        origin: "branch_promotion",
        status: "committed",
        metadata: { branch_id: BID },
        created_at: "2026-04-16T00:00:00Z",
      },
    ];

    vi.doMock("@/server/services/restore_service", () => ({
      restoreFromChangeSet: vi.fn().mockResolvedValue({
        ok: true,
        restoreChangeSetId: "cs-restore",
      }),
    }));
    vi.doMock("@/server/services/change_set_service", () => ({
      listChangeSetItems: vi.fn().mockResolvedValue([{ id: "i1" }]),
    }));

    const client = {
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        const filters: Record<string, unknown> = {};
        b.select = () => {
          const s: Record<string, unknown> = {};
          s.eq = (c: string, v: unknown) => { filters[c] = v; return s; };
          s.in = (_c: string, values: unknown[]) => { seenInValues.push(values); return s; };
          s.order = () => s;
          s.maybeSingle = async () => {
            if (table === "draft_branches") {
              return {
                data: { id: BID, workspace_id: WS, name: "x", status: "promoted" },
                error: null,
              };
            }
            return { data: null, error: null };
          };
          s.then = async (r: (v: { data: unknown; error: null }) => void) => {
            if (table === "change_sets") {
              r({ data: mockChangeSets, error: null });
            } else {
              r({ data: [], error: null });
            }
          };
          return s;
        };
        b.update = () => {
          const u: Record<string, unknown> = {};
          u.eq = () => u;
          u.then = async (r: (v: { error: null }) => void) => r({ error: null });
          return u;
        };
        b.eq = () => b;
        return b;
      },
    } as never;

    const { rollbackBranchPromotion } = await import("@/server/services/branch_rollback_service");
    const res = await rollbackBranchPromotion(client, BID, UID);
    expect(res.changeSetId).toBe("cs-restore");
    // Verify the query used .in(origin, [...]) with both values,
    // not .eq(origin, 'branch_promotion') — i.e. partial promote
    // change sets are eligible for rollback lookup.
    expect(seenInValues.length).toBeGreaterThan(0);
    expect(seenInValues[0]).toEqual([
      "branch_promotion",
      "branch_promotion_partial",
    ]);
  });
});
