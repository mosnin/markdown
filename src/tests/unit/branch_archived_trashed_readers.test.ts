import { describe, it, expect } from "vitest";

/**
 * Tests for the branch-aware overlay on archived/trashed listings.
 *
 * Covers the semantic described in
 * `docs/branch_local_structural_creation_v1.md#v1.8`:
 *
 *   1. A canonically-archived row that has a pending `unarchive` op
 *      for the active branch is HIDDEN from the archived listing.
 *   2. A canonically-active row that has a pending `trash` op for the
 *      active branch is SHOWN in the trashed listing (branch-local
 *      trash is surfaced alongside the canonical trashed set).
 *   3. A canonically-archived row with no conflicting op for the
 *      branch passes through unchanged.
 */

import {
  listArchivedNotesByBox,
  listTrashedNotesByBox,
} from "@/server/repositories/note_repository";
import {
  listArchivedFoldersByBox,
  listTrashedFoldersByBox,
} from "@/server/repositories/folder_repository";

const BOX_ID = "box-1";
const BRANCH_ID = "branch-1";

/**
 * Minimal Supabase double that supports two shapes:
 *
 *   - Table fetch with filters + `.or()` and terminal `.then()` —
 *     returns rows from `tableRows[table]` filtered by the eq/is/or
 *     clauses the loader issues.
 *   - `branch_pending_ops` fetch via `listPendingOps` — returns the
 *     supplied ops list.
 *
 * The goal is not a full PostgREST emulator; it's just enough to
 * exercise the overlay branches in the repository readers.
 */
function makeSupabase(opts: {
  tableRows: Record<string, Array<Record<string, unknown>>>;
  pendingOps: Array<Record<string, unknown>>;
}) {
  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    let orFilter: string | null = null;
    let inFilter: { col: string; vals: unknown[] } | null = null;
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (col: string, v: unknown) => {
      filters[col] = v;
      return q;
    };
    q.neq = () => q;
    q.is = (col: string, v: unknown) => {
      filters[`${col}:is`] = v;
      return q;
    };
    q.in = (col: string, vals: unknown[]) => {
      inFilter = { col, vals };
      return q;
    };
    q.or = (expr: string) => {
      orFilter = expr;
      return q;
    };
    q.order = () => q;
    q.limit = () => q;
    q.range = () => q;
    q.then = async (resolve: (v: { data: unknown[]; error: null }) => void) => {
      if (table === "branch_pending_ops") {
        const ops = opts.pendingOps.filter((o) => {
          if (filters["branch_id"] && o.branch_id !== filters["branch_id"]) return false;
          if (filters["applied_at:is"] === null && o.applied_at !== null) return false;
          if (filters["op_type"] && o.op_type !== filters["op_type"]) return false;
          return true;
        });
        resolve({ data: ops, error: null });
        return;
      }
      const source = opts.tableRows[table] ?? [];
      const out = source.filter((r) => {
        for (const [k, v] of Object.entries(filters)) {
          if (k.endsWith(":is")) {
            const col = k.slice(0, -3);
            if ((r as Record<string, unknown>)[col] !== v) return false;
          } else if ((r as Record<string, unknown>)[k] !== v) {
            return false;
          }
        }
        if (inFilter) {
          if (!inFilter.vals.includes((r as Record<string, unknown>)[inFilter.col])) return false;
        }
        if (orFilter) {
          const match = orFilter.match(/branch_id\.eq\.([^,)]+)/);
          const branchId = match?.[1];
          if (!(r.branch_id === null || r.branch_id === branchId)) return false;
        }
        return true;
      });
      resolve({ data: out, error: null });
    };
    return q;
  }
  return { from: (table: string) => builder(table) } as never;
}

describe("listArchivedNotesByBox branch overlay", () => {
  const canonicalArchived = {
    id: "note-canon",
    box_id: BOX_ID,
    branch_id: null,
    status: "archived",
    updated_at: "2024-01-01",
  };
  const canonicalArchivedUntouched = {
    id: "note-passthrough",
    box_id: BOX_ID,
    branch_id: null,
    status: "archived",
    updated_at: "2024-01-02",
  };
  const mainActiveArchivedOnBranch = {
    id: "note-on-branch",
    box_id: BOX_ID,
    branch_id: null,
    status: "active",
    updated_at: "2024-01-03",
  };

  it("hides canonical archived rows the branch has an unarchive op for", async () => {
    const sb = makeSupabase({
      tableRows: {
        notes: [canonicalArchived, canonicalArchivedUntouched],
      },
      pendingOps: [
        {
          object_type: "note",
          object_id: "note-canon",
          op_type: "unarchive",
          branch_id: BRANCH_ID,
          applied_at: null,
        },
      ],
    });
    const out = await listArchivedNotesByBox(sb, BOX_ID, { branchId: BRANCH_ID });
    expect(out.map((n) => n.id).sort()).toEqual(["note-passthrough"]);
  });

  it("includes main-active rows with a pending archive op on the branch", async () => {
    const sb = makeSupabase({
      tableRows: {
        notes: [canonicalArchived, mainActiveArchivedOnBranch],
      },
      pendingOps: [
        {
          object_type: "note",
          object_id: "note-on-branch",
          op_type: "archive",
          branch_id: BRANCH_ID,
          applied_at: null,
        },
      ],
    });
    const out = await listArchivedNotesByBox(sb, BOX_ID, { branchId: BRANCH_ID });
    expect(out.map((n) => n.id).sort()).toEqual(["note-canon", "note-on-branch"]);
  });

  it("passes canonical archived rows through when no conflicting op exists", async () => {
    const sb = makeSupabase({
      tableRows: { notes: [canonicalArchivedUntouched] },
      pendingOps: [],
    });
    const out = await listArchivedNotesByBox(sb, BOX_ID, { branchId: BRANCH_ID });
    expect(out.map((n) => n.id)).toEqual(["note-passthrough"]);
  });
});

describe("listTrashedNotesByBox branch overlay", () => {
  const canonicalTrashed = {
    id: "note-trash",
    box_id: BOX_ID,
    branch_id: null,
    status: "trashed",
    updated_at: "2024-01-01",
  };
  const mainActiveTrashedOnBranch = {
    id: "note-br-trash",
    box_id: BOX_ID,
    branch_id: null,
    status: "active",
    updated_at: "2024-01-02",
  };

  it("shows main-active rows that the branch has a pending trash op for", async () => {
    const sb = makeSupabase({
      tableRows: { notes: [canonicalTrashed, mainActiveTrashedOnBranch] },
      pendingOps: [
        {
          object_type: "note",
          object_id: "note-br-trash",
          op_type: "trash",
          branch_id: BRANCH_ID,
          applied_at: null,
        },
      ],
    });
    const out = await listTrashedNotesByBox(sb, BOX_ID, { branchId: BRANCH_ID });
    expect(out.map((n) => n.id).sort()).toEqual(["note-br-trash", "note-trash"]);
  });
});

describe("listArchivedFoldersByBox / listTrashedFoldersByBox branch overlay", () => {
  const archivedFolder = {
    id: "f-arch",
    box_id: BOX_ID,
    branch_id: null,
    status: "archived",
    path_cache: "a",
  };
  const activeFolderOnBranchTrash = {
    id: "f-active-br",
    box_id: BOX_ID,
    branch_id: null,
    status: "active",
    path_cache: "b",
  };

  it("archived: hides folders the branch unarchived; keeps passthrough", async () => {
    const sb = makeSupabase({
      tableRows: {
        folders: [
          archivedFolder,
          {
            id: "f-keep",
            box_id: BOX_ID,
            branch_id: null,
            status: "archived",
            path_cache: "c",
          },
        ],
      },
      pendingOps: [
        {
          object_type: "folder",
          object_id: "f-arch",
          op_type: "unarchive",
          branch_id: BRANCH_ID,
          applied_at: null,
        },
      ],
    });
    const out = await listArchivedFoldersByBox(sb, BOX_ID, { branchId: BRANCH_ID });
    expect(out.map((f) => f.id).sort()).toEqual(["f-keep"]);
  });

  it("trashed: surfaces main-active folders with pending trash op", async () => {
    const sb = makeSupabase({
      tableRows: { folders: [activeFolderOnBranchTrash] },
      pendingOps: [
        {
          object_type: "folder",
          object_id: "f-active-br",
          op_type: "trash",
          branch_id: BRANCH_ID,
          applied_at: null,
        },
      ],
    });
    const out = await listTrashedFoldersByBox(sb, BOX_ID, { branchId: BRANCH_ID });
    expect(out.map((f) => f.id)).toEqual(["f-active-br"]);
  });
});
