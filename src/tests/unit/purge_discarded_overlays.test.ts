import { describe, it, expect } from "vitest";

/**
 * Unit tests for purgeDiscardedOverlays.
 *
 * Critical safety invariants:
 *   1. Overlays whose parent branch is `discarded` ARE deleted.
 *   2. Overlays whose parent branch is `promoted` ARE deleted.
 *   3. Overlays whose parent branch is `open` are NEVER deleted —
 *      these belong to live drafts.
 *   4. Overlays in a different workspace are NOT touched, even if the
 *      owning branch has a terminal status in that workspace.
 */

import { purgeDiscardedOverlays } from "@/server/services/package_branch_service";

// ─── Mock builder ─────────────────────────────────────────────────────────────

/**
 * Minimal Supabase client mock for purgeDiscardedOverlays tests.
 *
 * Simulates a set of draft_branches and branch_package_metadata rows.
 * Captures which overlay IDs were deleted so assertions can verify the
 * exact subset targeted by the purge.
 */
function makeMockSupabase(opts: {
  branches: Array<{ id: string; workspace_id: string; status: string }>;
  overlays: Array<{ id: string; branch_id: string }>;
}) {
  const { branches, overlays } = opts;
  const deletedOverlayIds: string[] = [];

  function fromFn(table: string) {
    // Accumulate filter state as the builder chain is constructed.
    const state: {
      eqFilters: Record<string, unknown>;
      inFilters: Record<string, unknown[]>;
    } = { eqFilters: {}, inFilters: {} };

    const builder: Record<string, unknown> = {};

    builder.select = () => builder;

    builder.eq = (col: string, val: unknown) => {
      state.eqFilters[col] = val;
      return builder;
    };

    builder.in = (col: string, vals: unknown[]) => {
      state.inFilters[col] = vals as unknown[];
      return builder;
    };

    // Terminal-branch ID fetch — resolves immediately.
    builder.then = async (
      resolve: (v: { data: unknown[]; error: null }) => void
    ) => {
      if (table === "draft_branches") {
        const workspaceId = state.eqFilters["workspace_id"];
        const statuses = state.inFilters["status"] ?? [];
        const matched = branches.filter(
          (b) =>
            b.workspace_id === workspaceId &&
            statuses.includes(b.status)
        );
        resolve({ data: matched, error: null });
        return;
      }
      resolve({ data: [], error: null });
    };

    // Overlay delete — records which IDs were removed and returns them.
    builder.delete = () => {
      const deleteBuilder: Record<string, unknown> = {};
      deleteBuilder.in = (col: string, vals: unknown[]) => {
        state.inFilters[col] = vals as unknown[];
        return deleteBuilder;
      };
      deleteBuilder.select = () => deleteBuilder;
      deleteBuilder.then = async (
        resolve: (v: { data: unknown[]; error: null }) => void
      ) => {
        const branchIds = (state.inFilters["branch_id"] ?? []) as string[];
        const matched = overlays.filter((o) =>
          branchIds.includes(o.branch_id)
        );
        for (const m of matched) deletedOverlayIds.push(m.id);
        resolve({ data: matched, error: null });
      };
      return deleteBuilder;
    };

    return builder;
  }

  return {
    client: { from: fromFn } as never,
    deletedOverlayIds,
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS_A = "workspace-a";
const WS_B = "workspace-b";

const BRANCHES = [
  { id: "branch-discarded", workspace_id: WS_A, status: "discarded" },
  { id: "branch-promoted",  workspace_id: WS_A, status: "promoted"  },
  { id: "branch-open",      workspace_id: WS_A, status: "open"      },
  { id: "branch-other-ws",  workspace_id: WS_B, status: "discarded" },
];

const OVERLAYS = [
  { id: "overlay-discarded", branch_id: "branch-discarded" },
  { id: "overlay-promoted",  branch_id: "branch-promoted"  },
  { id: "overlay-open",      branch_id: "branch-open"      },
  { id: "overlay-other-ws",  branch_id: "branch-other-ws"  },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("purgeDiscardedOverlays", () => {
  it("deletes overlays whose parent branch is discarded", async () => {
    const { client, deletedOverlayIds } = makeMockSupabase({
      branches: BRANCHES,
      overlays: OVERLAYS,
    });

    await purgeDiscardedOverlays(client, WS_A);

    expect(deletedOverlayIds).toContain("overlay-discarded");
  });

  it("deletes overlays whose parent branch is promoted", async () => {
    const { client, deletedOverlayIds } = makeMockSupabase({
      branches: BRANCHES,
      overlays: OVERLAYS,
    });

    await purgeDiscardedOverlays(client, WS_A);

    expect(deletedOverlayIds).toContain("overlay-promoted");
  });

  it("PRESERVES overlays whose parent branch is still open", async () => {
    const { client, deletedOverlayIds } = makeMockSupabase({
      branches: BRANCHES,
      overlays: OVERLAYS,
    });

    await purgeDiscardedOverlays(client, WS_A);

    // This is the critical safety invariant — live-draft overlays must
    // survive the purge entirely.
    expect(deletedOverlayIds).not.toContain("overlay-open");
  });

  it("does not touch overlays in a different workspace", async () => {
    const { client, deletedOverlayIds } = makeMockSupabase({
      branches: BRANCHES,
      overlays: OVERLAYS,
    });

    // Purge targets WS_A only; the branch-other-ws branch lives in WS_B.
    await purgeDiscardedOverlays(client, WS_A);

    expect(deletedOverlayIds).not.toContain("overlay-other-ws");
  });

  it("returns deletedCount equal to the number of rows removed", async () => {
    const { client } = makeMockSupabase({
      branches: BRANCHES,
      overlays: OVERLAYS,
    });

    const result = await purgeDiscardedOverlays(client, WS_A);

    // WS_A has two terminal branches (discarded + promoted), each with
    // one overlay → expect deletedCount = 2.
    expect(result.deletedCount).toBe(2);
  });

  it("returns deletedCount of 0 when no terminal branches exist", async () => {
    const { client } = makeMockSupabase({
      branches: [{ id: "branch-open", workspace_id: WS_A, status: "open" }],
      overlays: [{ id: "overlay-open", branch_id: "branch-open" }],
    });

    const result = await purgeDiscardedOverlays(client, WS_A);

    expect(result.deletedCount).toBe(0);
  });
});
