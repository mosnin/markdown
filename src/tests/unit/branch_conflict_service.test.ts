import { describe, it, expect, vi } from "vitest";

/**
 * Unit tests for `detectConflicts` and `rebaseBranch`.
 *
 * Invariants:
 *
 *   1. No conflict when main hasn't changed (mainVersionId === branchParentVersionId).
 *   2. Conflict detected when main version differs from branch's parent version.
 *   3. Rebase 'rebase_branch_on_main' creates a new version with correct parent.
 *   4. Rebase 'keep_main' removes the branch head.
 *   5. Rebase 'keep_branch' re-anchors (same as rebase_branch_on_main).
 */

vi.mock("@/server/services/branch_service");
vi.mock("@/server/repositories/audit_event_repository");

import { detectConflicts } from "@/server/services/branch_conflict_service";
import { rebaseBranch } from "@/server/services/branch_rebase_service";
import * as branchService from "@/server/services/branch_service";
import * as auditRepo from "@/server/repositories/audit_event_repository";

const BRANCH_ID = "branch-1";
const WORKSPACE_ID = "ws-1";
const ACTOR_ID = "user-1";

function makeMockSupabase(overrides: {
  noteMain?: {
    id: string;
    title: string;
    markdown_content: string;
    current_version_id: string | null;
  } | null;
  noteBranchVer?: {
    id: string;
    parent_version_id: string | null;
    markdown_content: string;
  } | null;
  noteBaseVer?: {
    markdown_content: string;
  } | null;
  fileMain?: {
    id: string;
    name: string;
    source_content: string;
    current_version_id: string | null;
  } | null;
  fileBranchVer?: {
    id: string;
    parent_version_id: string | null;
    source_content: string;
  } | null;
  fileBaseVer?: {
    source_content: string;
  } | null;
  branchStatus?: string;
  branchWorkspaceId?: string;
} = {}) {
  const {
    noteMain,
    noteBranchVer,
    noteBaseVer,
    fileMain,
    fileBranchVer,
    fileBaseVer,
    branchStatus = "open",
    branchWorkspaceId = WORKSPACE_ID,
  } = overrides;

  const deletedRows: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const insertedRows: Array<{ table: string; data: Record<string, unknown> }> = [];
  const updatedRows: Array<{ table: string; data: Record<string, unknown>; filters: Record<string, unknown> }> = [];

  function fromFn(table: string) {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => { filters[col] = val; return builder; };
    builder.in = () => builder;
    builder.is = () => builder;
    builder.order = () => builder;
    builder.delete = () => {
      const deleteBuilder: Record<string, unknown> = {};
      deleteBuilder.eq = (col: string, val: unknown) => {
        deletedRows.push({ table, filters: { ...filters, [col]: val } });
        return deleteBuilder;
      };
      return deleteBuilder;
    };
    builder.insert = (data: Record<string, unknown>) => {
      insertedRows.push({ table, data });
      const insertBuilder: Record<string, unknown> = {};
      insertBuilder.select = () => insertBuilder;
      insertBuilder.single = async () => ({
        data: { id: "new-version-id", ...data },
        error: null,
      });
      return insertBuilder;
    };
    builder.update = (data: Record<string, unknown>) => {
      const updateBuilder: Record<string, unknown> = {};
      updateBuilder.eq = (col: string, val: unknown) => {
        updatedRows.push({ table, data, filters: { ...filters, [col]: val } });
        return updateBuilder;
      };
      return updateBuilder;
    };
    builder.then = async (resolve: (v: { data: unknown[]; error: null }) => void) => {
      resolve({ data: [], error: null });
    };
    builder.maybeSingle = async () => {
      if (table === "draft_branches") {
        return {
          data: {
            id: BRANCH_ID,
            workspace_id: branchWorkspaceId,
            name: "test-branch",
            status: branchStatus,
          },
          error: null,
        };
      }
      if (table === "notes") return { data: noteMain ?? null, error: null };
      if (table === "note_versions") {
        // Determine which version is being queried by checking the id filter
        if (filters.id === noteBranchVer?.id) {
          return { data: noteBranchVer ?? null, error: null };
        }
        if (noteBaseVer) {
          return { data: noteBaseVer, error: null };
        }
        return { data: noteBranchVer ?? null, error: null };
      }
      if (table === "files") return { data: fileMain ?? null, error: null };
      if (table === "object_versions") {
        if (filters.id === fileBranchVer?.id) {
          return { data: fileBranchVer ?? null, error: null };
        }
        if (fileBaseVer) {
          return { data: fileBaseVer, error: null };
        }
        return { data: fileBranchVer ?? null, error: null };
      }
      if (table === "audit_events") {
        return { data: { id: "audit-1" }, error: null };
      }
      return { data: null, error: null };
    };
    return builder;
  }

  return {
    from: fromFn,
    _deletedRows: deletedRows,
    _insertedRows: insertedRows,
    _updatedRows: updatedRows,
  } as never;
}

describe("detectConflicts", () => {
  it("returns empty array when main hasn't changed", async () => {
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([
      {
        id: "head-1",
        branch_id: BRANCH_ID,
        object_type: "note",
        object_id: "note-1",
        version_id: "ver-branch",
        updated_at: new Date().toISOString(),
      } as never,
    ]);

    const supabase = makeMockSupabase({
      noteMain: {
        id: "note-1",
        title: "Doc",
        markdown_content: "main body",
        current_version_id: "ver-main", // same as parent
      },
      noteBranchVer: {
        id: "ver-branch",
        parent_version_id: "ver-main", // matches main's current
        markdown_content: "branch body",
      },
    });

    const result = await detectConflicts(supabase, BRANCH_ID);
    expect(result).toEqual([]);
  });

  it("detects conflict when main version differs from branch parent", async () => {
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([
      {
        id: "head-1",
        branch_id: BRANCH_ID,
        object_type: "note",
        object_id: "note-1",
        version_id: "ver-branch",
        updated_at: new Date().toISOString(),
      } as never,
    ]);

    const supabase = makeMockSupabase({
      noteMain: {
        id: "note-1",
        title: "Doc",
        markdown_content: "main advanced body",
        current_version_id: "ver-main-newer", // NOT the branch's parent
      },
      noteBranchVer: {
        id: "ver-branch",
        parent_version_id: "ver-main-original", // the fork point
        markdown_content: "branch body",
      },
      noteBaseVer: {
        markdown_content: "original body",
      },
    });

    const result = await detectConflicts(supabase, BRANCH_ID);
    expect(result).toHaveLength(1);
    expect(result[0].objectType).toBe("note");
    expect(result[0].objectId).toBe("note-1");
    expect(result[0].mainVersionId).toBe("ver-main-newer");
    expect(result[0].branchVersionId).toBe("ver-branch");
    expect(result[0].branchParentVersionId).toBe("ver-main-original");
    expect(result[0].displayName).toBe("Doc");
  });

  it("returns empty when branch has no heads", async () => {
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([]);
    const supabase = makeMockSupabase();
    const result = await detectConflicts(supabase, BRANCH_ID);
    expect(result).toEqual([]);
  });

  it("detects conflict for file heads through object_versions", async () => {
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([
      {
        id: "head-2",
        branch_id: BRANCH_ID,
        object_type: "file",
        object_id: "file-1",
        version_id: "ver-branch-file",
        updated_at: new Date().toISOString(),
      } as never,
    ]);

    const supabase = makeMockSupabase({
      fileMain: {
        id: "file-1",
        name: "script.py",
        source_content: "print('main advanced')",
        current_version_id: "ver-main-file-newer",
      },
      fileBranchVer: {
        id: "ver-branch-file",
        parent_version_id: "ver-main-file-original",
        source_content: "print('branch')",
      },
      fileBaseVer: {
        source_content: "print('original')",
      },
    });

    const result = await detectConflicts(supabase, BRANCH_ID);
    expect(result).toHaveLength(1);
    expect(result[0].objectType).toBe("file");
  });
});

describe("rebaseBranch", () => {
  it("rebase_branch_on_main creates a new version with correct parent", async () => {
    vi.mocked(branchService.getDraftBranch).mockResolvedValue({
      id: BRANCH_ID,
      workspace_id: WORKSPACE_ID,
      name: "test",
      status: "open",
      description: null,
      base_change_set_id: null,
      created_by: ACTOR_ID,
      created_at: new Date().toISOString(),
      promoted_at: null,
      discarded_at: null,
    } as never);
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([
      {
        id: "head-1",
        branch_id: BRANCH_ID,
        object_type: "note",
        object_id: "note-1",
        version_id: "ver-branch",
        updated_at: new Date().toISOString(),
      } as never,
    ]);
    vi.mocked(auditRepo.createAuditEvent).mockResolvedValue({} as never);

    const supabase = makeMockSupabase({
      noteMain: {
        id: "note-1",
        title: "Doc",
        markdown_content: "main advanced",
        current_version_id: "ver-main-newer",
      },
      noteBranchVer: {
        id: "ver-branch",
        parent_version_id: "ver-main-original",
        markdown_content: "branch body",
      },
      noteBaseVer: {
        markdown_content: "original body",
      },
    });

    const result = await rebaseBranch(supabase, BRANCH_ID, WORKSPACE_ID, ACTOR_ID, {
      strategy: "rebase_branch_on_main",
    });

    expect(result.rebased).toBe(1);
    expect(result.conflicts).toBe(1);
  });

  it("keep_main removes the branch head", async () => {
    vi.mocked(branchService.getDraftBranch).mockResolvedValue({
      id: BRANCH_ID,
      workspace_id: WORKSPACE_ID,
      name: "test",
      status: "open",
      description: null,
      base_change_set_id: null,
      created_by: ACTOR_ID,
      created_at: new Date().toISOString(),
      promoted_at: null,
      discarded_at: null,
    } as never);
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([
      {
        id: "head-1",
        branch_id: BRANCH_ID,
        object_type: "note",
        object_id: "note-1",
        version_id: "ver-branch",
        updated_at: new Date().toISOString(),
      } as never,
    ]);
    vi.mocked(auditRepo.createAuditEvent).mockResolvedValue({} as never);

    const supabase = makeMockSupabase({
      noteMain: {
        id: "note-1",
        title: "Doc",
        markdown_content: "main advanced",
        current_version_id: "ver-main-newer",
      },
      noteBranchVer: {
        id: "ver-branch",
        parent_version_id: "ver-main-original",
        markdown_content: "branch body",
      },
    });

    const result = await rebaseBranch(supabase, BRANCH_ID, WORKSPACE_ID, ACTOR_ID, {
      strategy: "keep_main",
    });

    expect(result.rebased).toBe(1);
    // Verify it called delete on branch_heads
    const deleted = (supabase as unknown as { _deletedRows: Array<{ table: string }> })._deletedRows;
    expect(deleted.some((d) => d.table === "branch_heads")).toBe(true);
  });

  it("keep_branch re-anchors content on main (same as rebase)", async () => {
    vi.mocked(branchService.getDraftBranch).mockResolvedValue({
      id: BRANCH_ID,
      workspace_id: WORKSPACE_ID,
      name: "test",
      status: "open",
      description: null,
      base_change_set_id: null,
      created_by: ACTOR_ID,
      created_at: new Date().toISOString(),
      promoted_at: null,
      discarded_at: null,
    } as never);
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([
      {
        id: "head-1",
        branch_id: BRANCH_ID,
        object_type: "note",
        object_id: "note-1",
        version_id: "ver-branch",
        updated_at: new Date().toISOString(),
      } as never,
    ]);
    vi.mocked(auditRepo.createAuditEvent).mockResolvedValue({} as never);

    const supabase = makeMockSupabase({
      noteMain: {
        id: "note-1",
        title: "Doc",
        markdown_content: "main advanced",
        current_version_id: "ver-main-newer",
      },
      noteBranchVer: {
        id: "ver-branch",
        parent_version_id: "ver-main-original",
        markdown_content: "branch body",
      },
    });

    const result = await rebaseBranch(supabase, BRANCH_ID, WORKSPACE_ID, ACTOR_ID, {
      strategy: "keep_branch",
    });

    expect(result.rebased).toBe(1);
    // Verify a new version was inserted
    const inserted = (supabase as unknown as { _insertedRows: Array<{ table: string }> })._insertedRows;
    expect(inserted.some((i) => i.table === "note_versions")).toBe(true);
  });

  it("returns zero rebased when no conflicts exist", async () => {
    vi.mocked(branchService.getDraftBranch).mockResolvedValue({
      id: BRANCH_ID,
      workspace_id: WORKSPACE_ID,
      name: "test",
      status: "open",
      description: null,
      base_change_set_id: null,
      created_by: ACTOR_ID,
      created_at: new Date().toISOString(),
      promoted_at: null,
      discarded_at: null,
    } as never);
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([
      {
        id: "head-1",
        branch_id: BRANCH_ID,
        object_type: "note",
        object_id: "note-1",
        version_id: "ver-branch",
        updated_at: new Date().toISOString(),
      } as never,
    ]);

    const supabase = makeMockSupabase({
      noteMain: {
        id: "note-1",
        title: "Doc",
        markdown_content: "main body",
        current_version_id: "ver-main", // matches branch parent
      },
      noteBranchVer: {
        id: "ver-branch",
        parent_version_id: "ver-main",
        markdown_content: "branch body",
      },
    });

    const result = await rebaseBranch(supabase, BRANCH_ID, WORKSPACE_ID, ACTOR_ID, {
      strategy: "rebase_branch_on_main",
    });

    expect(result.rebased).toBe(0);
    expect(result.conflicts).toBe(0);
  });

  it("throws when branch is not open", async () => {
    vi.mocked(branchService.getDraftBranch).mockResolvedValue({
      id: BRANCH_ID,
      workspace_id: WORKSPACE_ID,
      name: "test",
      status: "promoted",
      description: null,
      base_change_set_id: null,
      created_by: ACTOR_ID,
      created_at: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
      discarded_at: null,
    } as never);

    const supabase = makeMockSupabase({ branchStatus: "promoted" });

    await expect(
      rebaseBranch(supabase, BRANCH_ID, WORKSPACE_ID, ACTOR_ID, {
        strategy: "rebase_branch_on_main",
      })
    ).rejects.toThrow("promoted");
  });
});
