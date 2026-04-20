import { describe, it, expect, vi } from "vitest";

import {
  listRunArtifacts,
  rollbackRun,
} from "@/server/services/operator_artifacts_service";

// ─── Helpers ────────────────────────────────────────────────────────────────
//
// The artifacts service composes two surfaces: workspace_operator_runs (read)
// and the notes table (read + the lifecycle service trash path). We hand it
// a tiny query stub that supports the small chain it exercises and inject
// the trash impl explicitly so we don't have to touch the lifecycle module.

interface FakeRunRow {
  id: string;
  workspace_id: string;
  user_id: string;
  notes_created: string[];
}

interface FakeNoteRow {
  id: string;
  title: string | null;
  status: string | null;
}

function makeSupabase(opts: {
  runRow?: FakeRunRow | null;
  noteRows?: FakeNoteRow[];
}) {
  const trashedIds: string[] = [];
  const updatedRunStatuses: string[] = [];

  function builder(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: Record<string, any> = {};
    let lastOp: "select" | "update" = "select";
    let updatePayload: Record<string, unknown> | null = null;
    b.select = () => b;
    b.update = (payload: Record<string, unknown>) => {
      lastOp = "update";
      updatePayload = payload;
      return b;
    };
    b.eq = () => b;
    b.in = () => b;
    b.maybeSingle = async () => {
      if (table === "workspace_operator_runs") {
        return { data: opts.runRow ?? null, error: null };
      }
      return { data: null, error: null };
    };
    b.single = async () => {
      if (lastOp === "update" && table === "workspace_operator_runs") {
        if (
          updatePayload &&
          typeof updatePayload.status === "string"
        ) {
          updatedRunStatuses.push(updatePayload.status);
        }
        return { data: opts.runRow ?? null, error: null };
      }
      return { data: null, error: null };
    };
    b.then = (resolve: (v: unknown) => void) => {
      if (table === "notes") {
        resolve({ data: opts.noteRows ?? [], error: null });
        return;
      }
      resolve({ data: [], error: null });
    };
    return b;
  }

  return {
    supabase: { from: builder } as unknown as Parameters<typeof listRunArtifacts>[0],
    trashedIds,
    updatedRunStatuses,
  };
}

// ─── listRunArtifacts ───────────────────────────────────────────────────────

describe("listRunArtifacts", () => {
  it("preserves the order in notes_created and surfaces missing rows as deleted", async () => {
    const { supabase } = makeSupabase({
      runRow: {
        id: "r-1",
        workspace_id: "ws-1",
        user_id: "u-1",
        notes_created: ["n-1", "n-2", "n-3"],
      },
      noteRows: [
        { id: "n-2", title: "Second", status: "active" },
        { id: "n-1", title: "First", status: "trashed" },
        // n-3 is intentionally missing → reported as deleted+title:null
      ],
    });
    const out = await listRunArtifacts(supabase, "r-1");
    expect(out).toEqual([
      { noteId: "n-1", title: "First", deleted: true },
      { noteId: "n-2", title: "Second", deleted: false },
      { noteId: "n-3", title: null, deleted: true },
    ]);
  });

  it("returns [] when the run is not found", async () => {
    const { supabase } = makeSupabase({ runRow: null });
    const out = await listRunArtifacts(supabase, "missing");
    expect(out).toEqual([]);
  });

  it("returns [] when the run has no recorded artifacts", async () => {
    const { supabase } = makeSupabase({
      runRow: {
        id: "r-1",
        workspace_id: "ws-1",
        user_id: "u-1",
        notes_created: [],
      },
    });
    const out = await listRunArtifacts(supabase, "r-1");
    expect(out).toEqual([]);
  });
});

// ─── rollbackRun ────────────────────────────────────────────────────────────

describe("rollbackRun", () => {
  it("calls trash for every artifact and tallies success", async () => {
    const { supabase } = makeSupabase({
      runRow: {
        id: "r-1",
        workspace_id: "ws-1",
        user_id: "u-1",
        notes_created: ["n-1", "n-2"],
      },
    });
    const trashSpy = vi.fn().mockResolvedValue({ id: "ok" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await rollbackRun(supabase, "r-1", "u-1", trashSpy as any);
    expect(trashSpy).toHaveBeenCalledTimes(2);
    expect(trashSpy).toHaveBeenNthCalledWith(1, supabase, "u-1", "ws-1", "n-1");
    expect(trashSpy).toHaveBeenNthCalledWith(2, supabase, "u-1", "ws-1", "n-2");
    expect(result.rolledBack).toBe(2);
    expect(result.alreadyDeleted).toBe(0);
    expect(result.errors).toEqual({});
  });

  it("counts already-trashed and missing notes as alreadyDeleted, not errors", async () => {
    const { supabase } = makeSupabase({
      runRow: {
        id: "r-1",
        workspace_id: "ws-1",
        user_id: "u-1",
        notes_created: ["n-1", "n-2", "n-3"],
      },
    });
    const trashSpy = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("Note is already trashed");
      })
      .mockImplementationOnce(() => {
        throw new Error("Note not found");
      })
      .mockImplementationOnce(() => Promise.resolve({ id: "ok" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await rollbackRun(supabase, "r-1", "u-1", trashSpy as any);
    expect(result.alreadyDeleted).toBe(2);
    expect(result.rolledBack).toBe(1);
    expect(result.errors).toEqual({});
  });

  it("captures unexpected per-artifact errors without throwing", async () => {
    const { supabase } = makeSupabase({
      runRow: {
        id: "r-1",
        workspace_id: "ws-1",
        user_id: "u-1",
        notes_created: ["n-1"],
      },
    });
    const trashSpy = vi.fn().mockImplementation(() => {
      throw new Error("guide note assignment");
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await rollbackRun(supabase, "r-1", "u-1", trashSpy as any);
    expect(result.rolledBack).toBe(0);
    expect(result.errors["n-1"]).toMatch(/guide note/);
  });

  it("rejects if caller is not the run owner", async () => {
    const { supabase } = makeSupabase({
      runRow: {
        id: "r-1",
        workspace_id: "ws-1",
        user_id: "owner",
        notes_created: ["n-1"],
      },
    });
    const trashSpy = vi.fn();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rollbackRun(supabase, "r-1", "intruder", trashSpy as any)
    ).rejects.toThrow(/runs you started/i);
    expect(trashSpy).not.toHaveBeenCalled();
  });
});
