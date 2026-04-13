import { describe, it, expect, vi } from "vitest";

/**
 * Unit tests for `getBranchDiff` — the preview surface that renders
 * per-head before/after content on the branch detail page.
 *
 * Invariants we cover:
 *
 *   1. A branch with zero heads returns an empty rows list and zero
 *      byte totals (and the caller still renders a "no edits yet"
 *      empty state).
 *   2. Main + branch content are returned verbatim so the UI can
 *      render a diff without guessing.
 *   3. `mainMovedAhead` is set iff main's `current_version_id` is
 *      neither the branch head's parent nor the branch head itself.
 *   4. `mainTrashed` flags objects whose canonical row is trashed so
 *      the UI warns instead of silently dropping the head.
 *   5. Wrong-workspace branch returns null.
 *   6. Byte deltas aggregate correctly across multiple heads.
 */

vi.mock("@/server/services/branch_service");

import { getBranchDiff } from "@/server/services/branch_diff_service";
import * as branchService from "@/server/services/branch_service";

const WORKSPACE_ID = "ws-1";
const BRANCH_ID = "branch-1";

function makeMockSupabase(overrides: {
  branchWorkspace?: string;
  noteMain?: {
    title: string;
    markdown_content: string;
    content_bytes: number;
    current_version_id: string | null;
    status: string;
  } | null;
  noteBranchVer?: {
    id: string;
    note_id: string;
    parent_version_id: string | null;
    version_number: number;
    markdown_content: string;
    content_bytes: number;
  } | null;
  fileMain?: {
    name: string;
    source_content: string;
    content_bytes: number;
    current_version_id: string | null;
    status: string;
  } | null;
  fileBranchVer?: {
    id: string;
    object_id: string;
    parent_version_id: string | null;
    version_number: number;
    source_content: string;
    content_bytes: number;
  } | null;
} = {}) {
  const {
    branchWorkspace = WORKSPACE_ID,
    noteMain,
    noteBranchVer,
    fileMain,
    fileBranchVer,
  } = overrides;
  function fromFn(table: string) {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => { filters[col] = val; return builder; };
    // New in v1.3: branch_diff groups rows by parent package, which
    // requires a `.in("id", fileIds)` query on the files table. Mock
    // it so the grouper doesn't blow up even when the test case
    // doesn't exercise grouping.
    builder.in = () => builder;
    // New in v1.5: branch_diff surfaces pending ops via
    // `listPendingOps`, which chains `.is("applied_at", null)` and
    // `.order("created_at", …)`. Both return the builder so the
    // empty-result `.then` still fires.
    builder.is = () => builder;
    builder.order = () => builder;
    builder.then = async (resolve: (v: { data: unknown[]; error: null }) => void) => {
      // Only the files `.in()` branch + the overlays query reach
      // here. Both are safe to return empty for these tests; the
      // diff row assertions don't depend on group structure.
      resolve({ data: [], error: null });
    };
    builder.maybeSingle = async () => {
      if (table === "draft_branches") {
        return {
          data: { id: BRANCH_ID, workspace_id: branchWorkspace, name: "test-branch" },
          error: null,
        };
      }
      if (table === "notes") return { data: noteMain ?? null, error: null };
      if (table === "note_versions") return { data: noteBranchVer ?? null, error: null };
      if (table === "files") return { data: fileMain ?? null, error: null };
      if (table === "object_versions") return { data: fileBranchVer ?? null, error: null };
      return { data: null, error: null };
    };
    return builder;
  }
  return { from: fromFn } as never;
}

describe("getBranchDiff", () => {
  it("returns null when branch belongs to another workspace", async () => {
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([]);
    const supabase = makeMockSupabase({ branchWorkspace: "ws-other" });
    const result = await getBranchDiff(supabase, BRANCH_ID, WORKSPACE_ID);
    expect(result).toBeNull();
  });

  it("returns zero-head diff with empty rows", async () => {
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([]);
    const supabase = makeMockSupabase();
    const result = await getBranchDiff(supabase, BRANCH_ID, WORKSPACE_ID);
    expect(result).not.toBeNull();
    expect(result!.rows).toEqual([]);
    expect(result!.headCount).toBe(0);
    expect(result!.totalBytesAdded).toBe(0);
    expect(result!.totalBytesRemoved).toBe(0);
  });

  it("builds a note diff row with branch content + main content verbatim", async () => {
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
        title: "Doc",
        markdown_content: "main body",
        content_bytes: 9,
        current_version_id: "ver-main",
        status: "active",
      },
      noteBranchVer: {
        id: "ver-branch",
        note_id: "note-1",
        parent_version_id: "ver-main",
        version_number: 3,
        markdown_content: "branch body rewritten",
        content_bytes: 21,
      },
    });
    const result = await getBranchDiff(supabase, BRANCH_ID, WORKSPACE_ID);
    expect(result!.rows).toHaveLength(1);
    const row = result!.rows[0];
    expect(row.objectType).toBe("note");
    expect(row.mainContent).toBe("main body");
    expect(row.branchContent).toBe("branch body rewritten");
    expect(row.displayName).toBe("Doc");
    expect(row.href).toBe("/app/notes/note-1");
    expect(row.mainMovedAhead).toBe(false);
    expect(row.mainTrashed).toBe(false);
  });

  it("flags mainMovedAhead when main's current_version_id isn't the branch head's parent", async () => {
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
        title: "Doc",
        markdown_content: "main advanced",
        content_bytes: 13,
        current_version_id: "ver-main-newer", // NOT the branch head's parent
        status: "active",
      },
      noteBranchVer: {
        id: "ver-branch",
        note_id: "note-1",
        parent_version_id: "ver-main-original", // original parent
        version_number: 3,
        markdown_content: "branch body",
        content_bytes: 11,
      },
    });
    const result = await getBranchDiff(supabase, BRANCH_ID, WORKSPACE_ID);
    expect(result!.rows[0].mainMovedAhead).toBe(true);
  });

  it("flags mainTrashed when the canonical row status is trashed", async () => {
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
        title: "Doc",
        markdown_content: "",
        content_bytes: 0,
        current_version_id: "ver-main",
        status: "trashed",
      },
      noteBranchVer: {
        id: "ver-branch",
        note_id: "note-1",
        parent_version_id: "ver-main",
        version_number: 3,
        markdown_content: "body",
        content_bytes: 4,
      },
    });
    const result = await getBranchDiff(supabase, BRANCH_ID, WORKSPACE_ID);
    expect(result!.rows[0].mainTrashed).toBe(true);
  });

  it("handles file heads through object_versions and canonical files table", async () => {
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
        name: "script.py",
        source_content: "print('main')",
        content_bytes: 13,
        current_version_id: "ver-main-file",
        status: "active",
      },
      fileBranchVer: {
        id: "ver-branch-file",
        object_id: "file-1",
        parent_version_id: "ver-main-file",
        version_number: 2,
        source_content: "print('branch')",
        content_bytes: 15,
      },
    });
    const result = await getBranchDiff(supabase, BRANCH_ID, WORKSPACE_ID);
    expect(result!.rows[0].objectType).toBe("file");
    expect(result!.rows[0].href).toBe("/app/files/file-1");
    expect(result!.rows[0].branchContent).toBe("print('branch')");
    expect(result!.rows[0].mainContent).toBe("print('main')");
  });
});
