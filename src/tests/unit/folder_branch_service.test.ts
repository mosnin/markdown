import { describe, it, expect } from "vitest";

/**
 * Unit tests for `folder_branch_service` — the per-branch overlay
 * layer that routes main-folder edits (rename / reparent / reorder)
 * through a separate `folder_branch_overrides` table instead of
 * mutating the canonical folder row.
 *
 * Invariants we cover:
 *
 *   1. `upsertFolderOverride` upserts on the (branch_id, folder_id)
 *      composite key so repeat edits on the same target merge into
 *      a single overlay row.
 *   2. `getFolderOverride` returns null when no overlay exists.
 *   3. `applyOverrideToFolder` is pure — null override fields mean
 *      "no change", non-null fields overlay the folder row, and
 *      the original folder object is never mutated.
 *   4. `listFolderOverridesForBranch` returns every overlay for the
 *      branch.
 *   5. `dropAllFolderOverridesForBranch` scopes the delete to the
 *      supplied branch_id.
 *   6. `promoteFolderOverrides` writes each overlay's non-null
 *      fields onto the canonical `folders` row and returns
 *      before/after snapshots the change-set recorder needs.
 */

import {
  upsertFolderOverride,
  getFolderOverride,
  listFolderOverridesForBranch,
  dropAllFolderOverridesForBranch,
  applyOverrideToFolder,
  promoteFolderOverrides,
  type FolderBranchOverride,
} from "@/server/services/folder_branch_service";
import type { Folder } from "@/server/domain/types/folder";

const BRANCH_ID = "branch-1";
const FOLDER_ID = "folder-1";
const ACTOR_ID = "user-1";

interface RecordedCall {
  table: string;
  op: "upsert" | "update" | "delete" | "select";
  args?: Record<string, unknown>;
  filters?: Array<{ col: string; val: unknown }>;
}

function makeSupabase(
  responses: {
    selectRows?: Record<string, unknown[]>;
    singleRow?: unknown;
    upsertReturn?: unknown;
    maybeSingleByTable?: Record<string, unknown>;
  } = {}
) {
  const calls: RecordedCall[] = [];

  function builder(table: string) {
    let op: RecordedCall["op"] = "select";
    const filters: RecordedCall["filters"] = [];
    let args: Record<string, unknown> | undefined;

    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => { filters!.push({ col, val }); return b; };
    b.is = (col: string, val: unknown) => { filters!.push({ col, val }); return b; };
    b.in = (col: string, val: unknown) => { filters!.push({ col, val }); return b; };
    b.order = () => b;
    b.upsert = (payload: Record<string, unknown>, opts?: unknown) => {
      op = "upsert"; args = { payload, opts }; return b;
    };
    b.update = (payload: Record<string, unknown>) => { op = "update"; args = { payload }; return b; };
    b.delete = () => { op = "delete"; return b; };
    b.single = async () => {
      calls.push({ table, op, args, filters });
      if (op === "upsert") {
        return { data: responses.upsertReturn ?? { id: "ov-1" }, error: null };
      }
      return { data: responses.singleRow ?? null, error: null };
    };
    b.maybeSingle = async () => {
      calls.push({ table, op, args, filters });
      if (responses.maybeSingleByTable && table in responses.maybeSingleByTable) {
        return { data: responses.maybeSingleByTable[table] ?? null, error: null };
      }
      return { data: responses.singleRow ?? null, error: null };
    };
    b.then = async (resolve: (v: { data: unknown[]; error: null }) => void) => {
      calls.push({ table, op, args, filters });
      resolve({ data: responses.selectRows?.[table] ?? [], error: null });
    };
    return b;
  }

  return {
    supabase: { from: (table: string) => builder(table) } as never,
    calls,
  };
}

function baseOverride(overrides: Partial<FolderBranchOverride> = {}): FolderBranchOverride {
  return {
    id: "ov-1",
    branch_id: BRANCH_ID,
    folder_id: FOLDER_ID,
    name: null,
    parent_folder_id: null,
    sort_order: null,
    path_cache: null,
    actor_id: ACTOR_ID,
    created_at: "now",
    updated_at: "now",
    ...overrides,
  };
}

function baseFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: FOLDER_ID,
    workspace_id: "ws-1",
    box_id: "box-1",
    parent_folder_id: null,
    parent_skill_id: null,
    parent_agent_id: null,
    name: "Original",
    slug: "original",
    path_cache: "original",
    description: null,
    accepts_generated_notes: false,
    status: "active",
    branch_id: null,
    created_at: "now",
    updated_at: "now",
    ...overrides,
  };
}

// ─── upsertFolderOverride ────────────────────────────────────────────────────

describe("upsertFolderOverride", () => {
  it("upserts with the (branch_id, folder_id) conflict target", async () => {
    const { supabase, calls } = makeSupabase({
      upsertReturn: baseOverride({ name: "Renamed" }),
    });
    const ov = await upsertFolderOverride(supabase, {
      branchId: BRANCH_ID,
      folderId: FOLDER_ID,
      actorId: ACTOR_ID,
      patch: { name: "Renamed" },
    });
    expect(ov.name).toBe("Renamed");
    const up = calls.find((c) => c.op === "upsert")!;
    expect(up.table).toBe("folder_branch_overrides");
    const args = up.args as { payload: Record<string, unknown>; opts: { onConflict: string } };
    expect(args.payload).toMatchObject({
      branch_id: BRANCH_ID,
      folder_id: FOLDER_ID,
      name: "Renamed",
      actor_id: ACTOR_ID,
    });
    expect(args.opts.onConflict).toBe("branch_id,folder_id");
  });

  it("only writes the fields present in the patch (undefined is skipped)", async () => {
    const { supabase, calls } = makeSupabase({ upsertReturn: baseOverride() });
    await upsertFolderOverride(supabase, {
      branchId: BRANCH_ID,
      folderId: FOLDER_ID,
      actorId: ACTOR_ID,
      patch: { path_cache: "boxes/a/renamed" },
    });
    const up = calls.find((c) => c.op === "upsert")!;
    const payload = (up.args as { payload: Record<string, unknown> }).payload;
    expect(payload).toHaveProperty("path_cache", "boxes/a/renamed");
    expect(payload).not.toHaveProperty("name");
    expect(payload).not.toHaveProperty("sort_order");
    expect(payload).not.toHaveProperty("parent_folder_id");
  });
});

// ─── getFolderOverride ───────────────────────────────────────────────────────

describe("getFolderOverride", () => {
  it("returns null when no overlay exists for the pair", async () => {
    const { supabase } = makeSupabase({ singleRow: null });
    const ov = await getFolderOverride(supabase, BRANCH_ID, FOLDER_ID);
    expect(ov).toBeNull();
  });

  it("returns the overlay row when present", async () => {
    const row = baseOverride({ name: "Renamed" });
    const { supabase } = makeSupabase({ singleRow: row });
    const ov = await getFolderOverride(supabase, BRANCH_ID, FOLDER_ID);
    expect(ov?.name).toBe("Renamed");
  });
});

// ─── applyOverrideToFolder ──────────────────────────────────────────────────

describe("applyOverrideToFolder", () => {
  it("is a no-op when override is null", () => {
    const folder = baseFolder({ name: "A", path_cache: "a" });
    const out = applyOverrideToFolder(folder, null);
    expect(out).toEqual(folder);
    // same fields, but different object reference would also be fine —
    // the invariant we assert is value-equality.
  });

  it("skips null override fields (inherit from main)", () => {
    const folder = baseFolder({ name: "A", path_cache: "a", parent_folder_id: "p-main" });
    const override = baseOverride({ name: null, path_cache: null, parent_folder_id: null });
    const out = applyOverrideToFolder(folder, override);
    expect(out.name).toBe("A");
    expect(out.path_cache).toBe("a");
    expect(out.parent_folder_id).toBe("p-main");
  });

  it("overlays non-null override fields and leaves the input unmutated", () => {
    const folder = baseFolder({ name: "A", path_cache: "a", parent_folder_id: null });
    const override = baseOverride({
      name: "A prime",
      path_cache: "a-prime",
      parent_folder_id: "p-new",
    });
    const out = applyOverrideToFolder(folder, override);
    expect(out.name).toBe("A prime");
    expect(out.path_cache).toBe("a-prime");
    expect(out.parent_folder_id).toBe("p-new");
    // Input untouched
    expect(folder.name).toBe("A");
    expect(folder.path_cache).toBe("a");
    expect(folder.parent_folder_id).toBeNull();
  });
});

// ─── listFolderOverridesForBranch ───────────────────────────────────────────

describe("listFolderOverridesForBranch", () => {
  it("returns every overlay row scoped to the branch_id", async () => {
    const { supabase, calls } = makeSupabase({
      selectRows: {
        folder_branch_overrides: [
          baseOverride({ folder_id: "f1", name: "N1" }),
          baseOverride({ folder_id: "f2", path_cache: "p2" }),
        ],
      },
    });
    const rows = await listFolderOverridesForBranch(supabase, BRANCH_ID);
    expect(rows).toHaveLength(2);
    const call = calls.find((c) => c.table === "folder_branch_overrides")!;
    expect(call.filters).toContainEqual({ col: "branch_id", val: BRANCH_ID });
  });
});

// ─── dropAllFolderOverridesForBranch ────────────────────────────────────────

describe("dropAllFolderOverridesForBranch", () => {
  it("deletes every override for the branch without any extra scoping", async () => {
    const { supabase, calls } = makeSupabase();
    await dropAllFolderOverridesForBranch(supabase, BRANCH_ID);
    const del = calls.find((c) => c.op === "delete")!;
    expect(del.table).toBe("folder_branch_overrides");
    expect(del.filters).toEqual([{ col: "branch_id", val: BRANCH_ID }]);
  });
});

// ─── promoteFolderOverrides ─────────────────────────────────────────────────

describe("promoteFolderOverrides", () => {
  it("writes overlay fields onto the canonical folders row and returns before/after", async () => {
    // listFolderOverridesForBranch reads folder_branch_overrides; the
    // before-read reads folders; the patch update writes folders.
    const { supabase, calls } = makeSupabase({
      selectRows: {
        folder_branch_overrides: [
          baseOverride({ folder_id: "f1", name: "Renamed", path_cache: "a/renamed" }),
        ],
      },
      maybeSingleByTable: {
        folders: { name: "Original", path_cache: "a/original" },
      },
    });

    const out = await promoteFolderOverrides(supabase, BRANCH_ID);
    expect(out).toHaveLength(1);
    expect(out[0].folderId).toBe("f1");
    expect(out[0].before).toMatchObject({ name: "Original", path_cache: "a/original" });
    expect(out[0].after).toMatchObject({ name: "Renamed", path_cache: "a/renamed" });

    const update = calls.find((c) => c.table === "folders" && c.op === "update")!;
    expect((update.args as { payload: Record<string, unknown> }).payload).toEqual({
      name: "Renamed",
      path_cache: "a/renamed",
    });
    expect(update.filters).toContainEqual({ col: "id", val: "f1" });
  });

  it("skips empty overlays (all override fields null) without writing", async () => {
    const { supabase, calls } = makeSupabase({
      selectRows: {
        folder_branch_overrides: [baseOverride({ folder_id: "f1" })],
      },
    });
    const out = await promoteFolderOverrides(supabase, BRANCH_ID);
    expect(out[0].before).toEqual({});
    expect(out[0].after).toEqual({});
    // No update on folders table.
    const update = calls.find((c) => c.table === "folders" && c.op === "update");
    expect(update).toBeUndefined();
  });
});
