"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createAdminClient } from "@/lib/supabase/admin";
import { rollbackNoteToVersion } from "@/server/services/version_history_service";
import {
  archiveNote,
  unarchiveNote,
  trashNote,
  restoreNote,
} from "@/server/services/lifecycle_service";
import { promoteGeneratedNote } from "@/server/services/generated_note_service";
import {
  withLifecycleChangeSet,
  lifecycleStatusFor,
} from "@/server/services/lifecycle_change_set";
import { log } from "@/lib/logger";

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Roll back a note to a selected prior version.
 * Human-only. Creates a new version (change_origin='rollback') — history is preserved.
 */
export async function rollbackNoteAction(
  noteId: string,
  targetVersionId: string
): Promise<ActionResult<{ new_version_id: string; version_number: number }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const adminClient = createAdminClient();

    const result = await rollbackNoteToVersion(
      adminClient,
      ctx.user!.id,
      ctx.workspace.id,
      noteId,
      targetVersionId
    );

    return {
      success: true,
      data: {
        new_version_id: result.new_version_id,
        version_number: result.version_number,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rollback failed";
    log.error("rollback_failed", { note_id: noteId, target_version_id: targetVersionId, reason: message });
    return { success: false, error: message };
  }
}

// Wrap each note lifecycle transition in a change set so it's grouped
// and restorable. The lifecycle service still enforces all guards
// (guide-note protection, status transition rules) — the wrapper is
// pure bookkeeping.

async function runNoteLifecycle(
  noteId: string,
  op: "archive" | "unarchive" | "trash" | "restore_lifecycle",
  perform: (supabase: ReturnType<typeof createAdminClient>, userId: string, workspaceId: string) => Promise<void>,
  beforeStatus: string
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = createAdminClient();

    // Branch-aware lifecycle: when the user is editing on a draft
    // branch, record the operation as a pending op instead of
    // applying it to main. Promote applies the op; discard drops
    // it. Main stays untouched either way.
    if (ctx.activeBranchId) {
      const { recordPendingOp, dropPendingOps } = await import(
        "@/server/services/pending_op_service"
      );
      // If the user unarchives on a branch, drop any previously
      // recorded archive op (swap semantics) rather than stacking.
      if (op === "unarchive") {
        await dropPendingOps(supabase, {
          branchId: ctx.activeBranchId,
          objectType: "note",
          objectId: noteId,
          opType: "archive",
        });
      } else if (op === "restore_lifecycle") {
        await dropPendingOps(supabase, {
          branchId: ctx.activeBranchId,
          objectType: "note",
          objectId: noteId,
          opType: "trash",
        });
      }
      const branchOpType = op === "restore_lifecycle"
        ? null  // handled by the drop above — no positive op to record
        : op === "archive" ? "archive" as const
        : op === "trash" ? "trash" as const
        : op === "unarchive" ? "unarchive" as const
        : null;
      if (branchOpType) {
        await recordPendingOp(supabase, {
          branchId: ctx.activeBranchId,
          actorId: ctx.user!.id,
          opType: branchOpType,
          objectType: "note",
          objectId: noteId,
          payload: {},
        });
      }
      return { success: true, data: undefined };
    }

    await withLifecycleChangeSet(
      supabase,
      {
        workspaceId: ctx.workspace.id,
        userId: ctx.user!.id,
        objectType: "note",
        objectId: noteId,
        operation: op,
        beforeStatus,
        afterStatus: lifecycleStatusFor(op),
        summary: `${op} note ${noteId.slice(0, 8)}`,
      },
      () => perform(supabase, ctx.user!.id, ctx.workspace.id)
    );
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/** Archive a note. Blocked if the note is the box's current guide note. */
export async function archiveNoteAction(noteId: string): Promise<ActionResult> {
  return runNoteLifecycle(
    noteId, "archive",
    async (sb, u, w) => { await archiveNote(sb, u, w, noteId); },
    "active"
  );
}

/** Unarchive a note, returning it to active. */
export async function unarchiveNoteAction(noteId: string): Promise<ActionResult> {
  return runNoteLifecycle(
    noteId, "unarchive",
    async (sb, u, w) => { await unarchiveNote(sb, u, w, noteId); },
    "archived"
  );
}

/** Move note to trash. Blocked if it is the box's current guide note. */
export async function trashNoteAction(noteId: string): Promise<ActionResult> {
  return runNoteLifecycle(
    noteId, "trash",
    async (sb, u, w) => { await trashNote(sb, u, w, noteId); },
    "active"
  );
}

/** Restore a trashed note to active. */
export async function restoreNoteAction(noteId: string): Promise<ActionResult> {
  return runNoteLifecycle(
    noteId, "restore_lifecycle",
    async (sb, u, w) => { await restoreNote(sb, u, w, noteId); },
    "trashed"
  );
}

/**
 * Promote a generated note to a standard user-managed note.
 * Human-only. Creates a new version (change_origin='promotion') — history is preserved.
 * Clears is_generated; origin_type and generated_by_connection_id remain for provenance.
 */
export async function promoteGeneratedNoteAction(
  noteId: string
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    await promoteGeneratedNote(createAdminClient(), ctx.user!.id, ctx.workspace.id, noteId);
    revalidatePath(`/app/notes/${noteId}`);
    return { success: true, data: undefined };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    log.error("promote_generated_note_failed", { note_id: noteId, reason });
    return { success: false, error: err instanceof Error ? err.message : "Failed to promote note" };
  }
}
