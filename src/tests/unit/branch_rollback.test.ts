import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRestoreFromChangeSet = vi.fn();
vi.mock("@/server/services/restore_service", () => ({
  restoreFromChangeSet: (...args: unknown[]) =>
    mockRestoreFromChangeSet(...args),
}));

vi.mock("@/server/services/change_set_service", () => ({
  listChangeSetItems: vi.fn().mockResolvedValue([
    { id: "item-1" },
    { id: "item-2" },
    { id: "item-3" },
  ]),
}));

import { rollbackBranchPromotion } from "@/server/services/branch_rollback_service";

const WS = "ws-rollback";
const UID = "user-actor";
const BID = "branch-promoted";
const CS_ID = "cs-promotion";
const RESTORE_CS = "cs-restore-001";

function makeMock(opts: {
  branchStatus?: string;
  hasPromotionCs?: boolean;
  updateError?: boolean;
} = {}) {
  const status = opts.branchStatus ?? "promoted";
  const hasCs = opts.hasPromotionCs ?? true;
  const updates: Array<{
    table: string;
    patch: Record<string, unknown>;
    filters: Record<string, unknown>;
  }> = [];

  function fromFn(table: string) {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};

    builder.select = () => {
      const s: Record<string, unknown> = {};
      s.eq = (c: string, v: unknown) => {
        filters[c] = v;
        return s;
      };
      s.order = () => s;
      s.maybeSingle = async () => {
        if (table === "draft_branches") {
          return {
            data: {
              id: BID,
              workspace_id: WS,
              name: "feature",
              status,
              promoted_at: "2026-04-15T00:00:00Z",
              discarded_at: null,
              rolled_back_at: null,
              rollback_change_set_id: null,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      };
      s.then = async (
        resolve: (v: { data: unknown[] | null; error: null }) => void
      ) => {
        if (table === "change_sets" && hasCs) {
          resolve({
            data: [
              {
                id: CS_ID,
                metadata: { branch_id: BID, branch_name: "feature" },
                status: "committed",
              },
            ],
            error: null,
          });
        } else {
          resolve({ data: [], error: null });
        }
      };
      return s;
    };

    builder.update = (patch: Record<string, unknown>) => {
      const cf: Record<string, unknown> = {};
      const u: Record<string, unknown> = {};
      u.eq = (c: string, v: unknown) => {
        cf[c] = v;
        return u;
      };
      u.then = async (
        resolve: (v: { error: { message: string } | null }) => void
      ) => {
        updates.push({ table, patch, filters: { ...cf } });
        if (opts.updateError && table === "draft_branches") {
          resolve({ error: { message: "Update failed" } });
        } else {
          resolve({ error: null });
        }
      };
      return u;
    };

    builder.eq = (c: string, v: unknown) => {
      filters[c] = v;
      return builder;
    };

    return builder;
  }

  return { client: { from: fromFn } as never, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRestoreFromChangeSet.mockResolvedValue({
    ok: true,
    restoreChangeSetId: RESTORE_CS,
    restoreRecordId: "rr-1",
    plan: { changeSetId: CS_ID, items: [], structural: [], blockers: [] },
  });
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("rollbackBranchPromotion", () => {
  it("restores before_snapshot values via the restore engine", async () => {
    const { client } = makeMock();
    const result = await rollbackBranchPromotion(client, BID, UID);

    expect(mockRestoreFromChangeSet).toHaveBeenCalledWith(
      client,
      WS,
      UID,
      CS_ID
    );
    expect(result.rolledBack).toBe(3);
    expect(result.changeSetId).toBe(RESTORE_CS);
  });

  it("sets branch status to 'rolled_back' with rolled_back_at", async () => {
    const { client, updates } = makeMock();
    await rollbackBranchPromotion(client, BID, UID);

    const branchUpdate = updates.find(
      (u) => u.table === "draft_branches" && u.patch.status === "rolled_back"
    );
    expect(branchUpdate).toBeDefined();
    expect(branchUpdate!.patch.rolled_back_at).toBeDefined();
    expect(branchUpdate!.patch.rollback_change_set_id).toBe(RESTORE_CS);
    expect(branchUpdate!.filters.status).toBe("promoted");
  });

  it("creates its own change set (the revert is itself reversible)", async () => {
    const { client } = makeMock();
    const result = await rollbackBranchPromotion(client, BID, UID);

    expect(result.changeSetId).toBe(RESTORE_CS);
    expect(mockRestoreFromChangeSet).toHaveBeenCalledTimes(1);
  });

  it("rejects rollback of a non-promoted branch", async () => {
    const { client } = makeMock({ branchStatus: "open" });
    await expect(rollbackBranchPromotion(client, BID, UID)).rejects.toThrow(
      /Only promoted branches/
    );
    expect(mockRestoreFromChangeSet).not.toHaveBeenCalled();
  });

  it("rejects rollback of an already rolled-back branch", async () => {
    const { client } = makeMock({ branchStatus: "rolled_back" });
    await expect(rollbackBranchPromotion(client, BID, UID)).rejects.toThrow(
      /Only promoted branches/
    );
    expect(mockRestoreFromChangeSet).not.toHaveBeenCalled();
  });

  it("rejects rollback of a discarded branch", async () => {
    const { client } = makeMock({ branchStatus: "discarded" });
    await expect(rollbackBranchPromotion(client, BID, UID)).rejects.toThrow(
      /Only promoted branches/
    );
  });

  it("throws when no promotion change set is found", async () => {
    const { client } = makeMock({ hasPromotionCs: false });
    await expect(rollbackBranchPromotion(client, BID, UID)).rejects.toThrow(
      /Could not find the promotion change set/
    );
  });

  it("throws when restore engine fails", async () => {
    mockRestoreFromChangeSet.mockResolvedValue({
      ok: false,
      error: "Missing before_snapshot on update item",
      plan: {
        changeSetId: CS_ID,
        items: [],
        structural: [],
        blockers: ["Missing before_snapshot"],
      },
    });
    const { client } = makeMock();
    await expect(rollbackBranchPromotion(client, BID, UID)).rejects.toThrow(
      /Rollback failed/
    );
  });
});
