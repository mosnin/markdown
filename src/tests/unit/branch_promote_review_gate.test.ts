import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for `promoteBranch`'s review-workflow gate. Two
 * independent gates:
 *
 *   1. `review_status` — 'draft' or 'approved' passes; any other
 *      value blocks promote with a clear error.
 *   2. Unresolved-comment count — a branch with any open thread is
 *      blocked unless { force: true } is set.
 *
 * These live ahead of the existing CAS guard so a blocked promote
 * never transitions the branch row away from 'open' — the UI can
 * retry after the author addresses the gate.
 */

vi.mock("@/server/services/change_set_service", async () => ({
  openChangeSet: vi.fn().mockResolvedValue({ id: "cs-gate", status: "open" }),
  commitChangeSet: vi.fn().mockResolvedValue(undefined),
  abortChangeSet: vi.fn().mockResolvedValue(undefined),
  recordChangeSetItem: vi.fn().mockResolvedValue(undefined),
  recordChangeSetItemsBatch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/box_branch_metadata_service", () => ({
  promoteBoxOverlays: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/server/services/folder_branch_service", () => ({
  promoteFolderOverrides: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/server/services/placement_branch_service", () => ({
  promotePlacementOverrides: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/server/services/pending_op_service", () => ({
  listPendingOps: vi.fn().mockResolvedValue([]),
  applyPendingOp: vi.fn(),
}));
vi.mock("@/server/services/branch_promotion_gate_service", () => ({
  runGates: vi.fn().mockResolvedValue({ allPassed: true, runs: [] }),
  GatePromotionError: class GatePromotionError extends Error {},
}));

import { promoteBranch } from "@/server/services/branch_service";

const WS = "ws-a";
const UID = "u-a";
const BID = "b-a";

type ReviewStatus =
  | "draft"
  | "review_requested"
  | "approved"
  | "changes_requested";

function makeMock(opts: {
  reviewStatus: ReviewStatus;
  unresolvedCommentCount?: number;
  casMatches?: number;
}) {
  let casLeft = opts.casMatches ?? 1;
  const updates: Array<{
    table: string;
    patch: Record<string, unknown>;
    filters: Record<string, unknown>;
  }> = [];

  function fromFn(table: string) {
    const filters: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    b.select = () => {
      const s: Record<string, unknown> = {};
      s.eq = (c: string, v: unknown) => {
        filters[c] = v;
        return s;
      };
      s.maybeSingle = async () => {
        if (table === "draft_branches") {
          return {
            data: {
              id: BID,
              workspace_id: WS,
              name: "a",
              status: "open",
              review_status: opts.reviewStatus,
            },
            error: null,
          };
        }
        if (table === "notes") {
          return {
            data: {
              id: "n1",
              current_version_id: "vm",
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
            data: { id: "vb", title: "t2", markdown_content: "m2", content_bytes: 2 },
            error: null,
          };
        }
        return { data: null, error: null };
      };
      s.single = s.maybeSingle;
      s.then = async (
        r: (v: { data: unknown; error: null }) => void
      ) => {
        if (table === "branch_heads") {
          r({
            data: [
              {
                id: "h1",
                branch_id: BID,
                object_type: "note",
                object_id: "n1",
                version_id: "vb",
              },
            ],
            error: null,
          });
        } else if (table === "branch_comments") {
          const rows: Array<{ id: string }> = [];
          const n = opts.unresolvedCommentCount ?? 0;
          for (let i = 0; i < n; i++) rows.push({ id: `c-${i}` });
          r({ data: rows, error: null });
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
        if (
          table === "draft_branches" &&
          cf.status === "open" &&
          patch.status === "promoting"
        ) {
          updates.push({ table, patch, filters: { ...cf } });
          const m = casLeft > 0 ? 1 : 0;
          casLeft--;
          return Promise.resolve({ data: m ? [{ id: BID }] : [], error: null });
        }
        updates.push({ table, patch, filters: { ...cf } });
        return Promise.resolve({ data: [{ id: "x" }], error: null });
      };
      u.then = async (r: (v: { error: null }) => void) => {
        updates.push({ table, patch, filters: { ...cf } });
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
  return { client: { from: fromFn } as never, updates };
}

beforeEach(() => vi.clearAllMocks());

describe("promoteBranch — review_status gate", () => {
  it("rejects when review_status=review_requested", async () => {
    const { client } = makeMock({ reviewStatus: "review_requested" });
    await expect(promoteBranch(client, WS, UID, BID)).rejects.toThrow(
      /review_status is review_requested/i
    );
  });

  it("rejects when review_status=changes_requested", async () => {
    const { client } = makeMock({ reviewStatus: "changes_requested" });
    await expect(promoteBranch(client, WS, UID, BID)).rejects.toThrow(
      /review_status is changes_requested/i
    );
  });

  it("succeeds from draft status (no review requested)", async () => {
    const { client, updates } = makeMock({ reviewStatus: "draft" });
    const r = await promoteBranch(client, WS, UID, BID);
    expect(r.branchId).toBe(BID);
    expect(
      updates.filter(
        (u) =>
          u.table === "draft_branches" &&
          u.patch.status === "promoted" &&
          u.filters.status === "promoting"
      )
    ).toHaveLength(1);
  });

  it("succeeds when review_status=approved", async () => {
    const { client, updates } = makeMock({ reviewStatus: "approved" });
    const r = await promoteBranch(client, WS, UID, BID);
    expect(r.branchId).toBe(BID);
    expect(
      updates.filter(
        (u) =>
          u.table === "draft_branches" &&
          u.patch.status === "promoted" &&
          u.filters.status === "promoting"
      )
    ).toHaveLength(1);
  });
});

describe("promoteBranch — unresolved-comments gate", () => {
  it("rejects when unresolved comments exist", async () => {
    const { client } = makeMock({
      reviewStatus: "approved",
      unresolvedCommentCount: 3,
    });
    await expect(promoteBranch(client, WS, UID, BID)).rejects.toThrow(
      /3 unresolved comments/i
    );
  });

  it("succeeds when approved + all resolved", async () => {
    const { client } = makeMock({
      reviewStatus: "approved",
      unresolvedCommentCount: 0,
    });
    const r = await promoteBranch(client, WS, UID, BID);
    expect(r.branchId).toBe(BID);
  });

  it("force: true bypasses the comment gate", async () => {
    const { client } = makeMock({
      reviewStatus: "approved",
      unresolvedCommentCount: 2,
    });
    const r = await promoteBranch(client, WS, UID, BID, { force: true });
    expect(r.branchId).toBe(BID);
  });

  it("force: true does NOT bypass review_status gate", async () => {
    const { client } = makeMock({
      reviewStatus: "changes_requested",
      unresolvedCommentCount: 0,
    });
    await expect(
      promoteBranch(client, WS, UID, BID, { force: true })
    ).rejects.toThrow(/review_status is changes_requested/i);
  });
});
