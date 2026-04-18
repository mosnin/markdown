import { describe, it, expect } from "vitest";

/**
 * Unit tests for `note_comment_service` — discussion threads on notes.
 *
 * Invariants we cover:
 *   1. `createNoteComment` persists a comment and returns it. Body is
 *      trimmed + validated.
 *   2. Replies must target a parent on the same note; cross-note
 *      grafting is rejected.
 *   3. `listNoteComments` returns threaded results (parent + children
 *      grouped).
 *   4. `resolveComment` stamps resolved=true + resolved_by +
 *      resolved_at.
 *   5. `unresolveComment` clears resolved metadata.
 *   6. `deleteComment` enforces author-only: a non-author is rejected.
 *   7. `countUnresolvedComments` returns top-level unresolved count.
 */

import {
  createNoteComment,
  listNoteComments,
  resolveComment,
  unresolveComment,
  deleteComment,
  countUnresolvedComments,
} from "@/server/services/note_comment_service";

const NOTE_ID = "note-1";
const WORKSPACE_ID = "ws-1";
const AUTHOR = "user-1";
const OTHER = "user-2";

interface Call {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  filters: Array<{ col: string; val: unknown }>;
  isFilters: Array<{ col: string; val: unknown }>;
  payload?: Record<string, unknown>;
}

function makeSupabase(opts: {
  parentComment?: {
    note_id: string;
    parent_comment_id: string | null;
  } | null;
  insertedRow?: Record<string, unknown>;
  updatedRow?: Record<string, unknown>;
  commentToDelete?: { id: string; author_id: string } | null;
  listRows?: Array<Record<string, unknown>>;
  unresolvedRows?: Array<{ id: string }>;
  /** When set, controls whether the note workspace lookup returns a row. Default: true. */
  noteExistsInWorkspace?: boolean;
}) {
  const calls: Call[] = [];
  function builder(table: string) {
    let op: Call["op"] = "select";
    const filters: Call["filters"] = [];
    const isFilters: Call["isFilters"] = [];
    let payload: Record<string, unknown> | undefined;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      filters.push({ col, val });
      return b;
    };
    b.is = (col: string, val: unknown) => {
      isFilters.push({ col, val });
      return b;
    };
    b.order = () => b;
    b.insert = (p: Record<string, unknown>) => {
      op = "insert";
      payload = p;
      return b;
    };
    b.update = (p: Record<string, unknown>) => {
      op = "update";
      payload = p;
      return b;
    };
    b.delete = () => {
      op = "delete";
      return b;
    };
    b.single = async () => {
      calls.push({ table, op, filters: [...filters], isFilters: [...isFilters], payload });
      if (op === "insert") {
        return {
          data:
            opts.insertedRow ?? {
              id: "c-new",
              note_id: NOTE_ID,
              workspace_id: WORKSPACE_ID,
              parent_comment_id: null,
              author_id: AUTHOR,
              body: "hi",
              resolved: false,
              resolved_by: null,
              resolved_at: null,
              created_at: "",
              updated_at: "",
            },
          error: null,
        };
      }
      if (op === "update") {
        return {
          data:
            opts.updatedRow ?? {
              id: "c-1",
              note_id: NOTE_ID,
              workspace_id: WORKSPACE_ID,
              parent_comment_id: null,
              author_id: AUTHOR,
              body: "hi",
              resolved: true,
              resolved_by: AUTHOR,
              resolved_at: "2026-04-18T00:00:00Z",
              created_at: "",
              updated_at: "",
            },
          error: null,
        };
      }
      return { data: null, error: null };
    };
    b.maybeSingle = async () => {
      calls.push({ table, op, filters: [...filters], isFilters: [...isFilters], payload });
      // Handle the notes table lookup for workspace validation
      if (op === "select" && table === "notes") {
        const noteInWs = opts.noteExistsInWorkspace ?? true;
        return {
          data: noteInWs ? { id: NOTE_ID } : null,
          error: null,
        };
      }
      if (op === "select" && table === "note_comments") {
        if (opts.parentComment !== undefined) {
          return { data: opts.parentComment, error: null };
        }
        if (opts.commentToDelete !== undefined) {
          return { data: opts.commentToDelete, error: null };
        }
      }
      return { data: null, error: null };
    };
    b.then = async (
      resolve: (v: { data: unknown[]; error: null }) => void
    ) => {
      calls.push({ table, op, filters: [...filters], isFilters: [...isFilters], payload });
      if (op === "delete") {
        resolve({ data: [], error: null });
        return;
      }
      // Check for unresolved count query: has resolved=false filter AND parent_comment_id IS null filter
      const hasResolvedFalseFilter = filters.some(
        (f) => f.col === "resolved" && f.val === false
      );
      const hasParentNullFilter = isFilters.some(
        (f) => f.col === "parent_comment_id" && f.val === null
      );
      if (hasResolvedFalseFilter && hasParentNullFilter) {
        resolve({ data: opts.unresolvedRows ?? [], error: null });
        return;
      }
      resolve({ data: opts.listRows ?? [], error: null });
    };
    return b;
  }
  return { supabase: { from: builder } as never, calls };
}

describe("createNoteComment", () => {
  it("persists a top-level comment", async () => {
    const { supabase, calls } = makeSupabase({});
    const out = await createNoteComment(supabase, {
      noteId: NOTE_ID,
      workspaceId: WORKSPACE_ID,
      authorId: AUTHOR,
      body: "needs tests",
    });
    expect(out.id).toBe("c-new");
    const insert = calls.find((c) => c.op === "insert");
    expect(insert!.payload).toMatchObject({
      note_id: NOTE_ID,
      workspace_id: WORKSPACE_ID,
      author_id: AUTHOR,
      body: "needs tests",
    });
  });

  it("rejects empty body", async () => {
    const { supabase } = makeSupabase({});
    await expect(
      createNoteComment(supabase, {
        noteId: NOTE_ID,
        workspaceId: WORKSPACE_ID,
        authorId: AUTHOR,
        body: "   ",
      })
    ).rejects.toThrow(/body is required/i);
  });

  it("rejects body exceeding 8000 characters", async () => {
    const { supabase } = makeSupabase({});
    await expect(
      createNoteComment(supabase, {
        noteId: NOTE_ID,
        workspaceId: WORKSPACE_ID,
        authorId: AUTHOR,
        body: "x".repeat(8001),
      })
    ).rejects.toThrow(/8000 characters/i);
  });

  it("rejects comment when note does not belong to workspace", async () => {
    const { supabase } = makeSupabase({ noteExistsInWorkspace: false });
    await expect(
      createNoteComment(supabase, {
        noteId: NOTE_ID,
        workspaceId: "wrong-workspace",
        authorId: AUTHOR,
        body: "hi",
      })
    ).rejects.toThrow(/does not belong to this workspace/i);
  });

  it("rejects reply whose parent is on a different note", async () => {
    const { supabase } = makeSupabase({
      parentComment: {
        note_id: "other-note",
        parent_comment_id: null,
      },
    });
    await expect(
      createNoteComment(supabase, {
        noteId: NOTE_ID,
        workspaceId: WORKSPACE_ID,
        parentCommentId: "parent-1",
        authorId: AUTHOR,
        body: "hi",
      })
    ).rejects.toThrow(/different note/i);
  });

  it("accepts reply on same note", async () => {
    const { supabase, calls } = makeSupabase({
      parentComment: {
        note_id: NOTE_ID,
        parent_comment_id: null,
      },
    });
    await createNoteComment(supabase, {
      noteId: NOTE_ID,
      workspaceId: WORKSPACE_ID,
      parentCommentId: "parent-1",
      authorId: AUTHOR,
      body: "agreed",
    });
    const insert = calls.find((c) => c.op === "insert");
    expect(insert!.payload).toMatchObject({
      parent_comment_id: "parent-1",
    });
  });
});

describe("listNoteComments", () => {
  it("returns threaded comments grouped by parent", async () => {
    const rows = [
      {
        id: "c1",
        note_id: NOTE_ID,
        workspace_id: WORKSPACE_ID,
        parent_comment_id: null,
        author_id: AUTHOR,
        body: "top",
        resolved: false,
        resolved_by: null,
        resolved_at: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "c2",
        note_id: NOTE_ID,
        workspace_id: WORKSPACE_ID,
        parent_comment_id: "c1",
        author_id: OTHER,
        body: "reply",
        resolved: false,
        resolved_by: null,
        resolved_at: null,
        created_at: "2026-01-01T00:01:00Z",
        updated_at: "2026-01-01T00:01:00Z",
      },
      {
        id: "c3",
        note_id: NOTE_ID,
        workspace_id: WORKSPACE_ID,
        parent_comment_id: null,
        author_id: OTHER,
        body: "another thread",
        resolved: false,
        resolved_by: null,
        resolved_at: null,
        created_at: "2026-01-01T00:02:00Z",
        updated_at: "2026-01-01T00:02:00Z",
      },
    ];
    const { supabase } = makeSupabase({ listRows: rows });
    const threads = await listNoteComments(supabase, NOTE_ID);
    expect(threads).toHaveLength(2);
    expect(threads[0].id).toBe("c1");
    expect(threads[0].replies).toHaveLength(1);
    expect(threads[0].replies[0].id).toBe("c2");
    expect(threads[1].id).toBe("c3");
    expect(threads[1].replies).toHaveLength(0);
  });
});

describe("resolveComment", () => {
  it("sets resolved=true with resolver + timestamp", async () => {
    const { supabase, calls } = makeSupabase({});
    await resolveComment(supabase, "c-1", AUTHOR);
    const update = calls.find((c) => c.op === "update");
    expect(update!.payload).toHaveProperty("resolved", true);
    expect(update!.payload).toHaveProperty("resolved_by", AUTHOR);
    expect(update!.payload).toHaveProperty("resolved_at");
  });
});

describe("unresolveComment", () => {
  it("clears resolved metadata", async () => {
    const { supabase, calls } = makeSupabase({
      updatedRow: {
        id: "c-1",
        note_id: NOTE_ID,
        workspace_id: WORKSPACE_ID,
        parent_comment_id: null,
        author_id: AUTHOR,
        body: "hi",
        resolved: false,
        resolved_by: null,
        resolved_at: null,
        created_at: "",
        updated_at: "",
      },
    });
    const out = await unresolveComment(supabase, "c-1");
    const update = calls.find((c) => c.op === "update");
    expect(update!.payload).toHaveProperty("resolved", false);
    expect(update!.payload).toHaveProperty("resolved_by", null);
    expect(update!.payload).toHaveProperty("resolved_at", null);
    expect(out.resolved).toBe(false);
  });
});

describe("deleteComment", () => {
  it("author can delete", async () => {
    const { supabase, calls } = makeSupabase({
      commentToDelete: { id: "c-1", author_id: AUTHOR },
    });
    await deleteComment(supabase, "c-1", AUTHOR);
    const del = calls.find((c) => c.op === "delete");
    expect(del).toBeDefined();
  });

  it("non-author is rejected", async () => {
    const { supabase } = makeSupabase({
      commentToDelete: { id: "c-1", author_id: AUTHOR },
    });
    await expect(
      deleteComment(supabase, "c-1", OTHER)
    ).rejects.toThrow(/author can delete/i);
  });

  it("throws when comment not found", async () => {
    const { supabase } = makeSupabase({
      commentToDelete: null,
    });
    await expect(
      deleteComment(supabase, "nonexistent", AUTHOR)
    ).rejects.toThrow(/not found/i);
  });
});

describe("countUnresolvedComments", () => {
  it("returns count of unresolved top-level comments", async () => {
    const { supabase } = makeSupabase({
      unresolvedRows: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
    });
    const n = await countUnresolvedComments(supabase, NOTE_ID);
    expect(n).toBe(3);
  });

  it("returns 0 when all resolved", async () => {
    const { supabase } = makeSupabase({ unresolvedRows: [] });
    const n = await countUnresolvedComments(supabase, NOTE_ID);
    expect(n).toBe(0);
  });
});
