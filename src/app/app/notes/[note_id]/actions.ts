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

/** Archive a note. Blocked if the note is the box's current guide note. */
export async function archiveNoteAction(
  noteId: string
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    await archiveNote(createAdminClient(), ctx.user!.id, ctx.workspace.id, noteId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/** Unarchive a note, returning it to active. */
export async function unarchiveNoteAction(
  noteId: string
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    await unarchiveNote(createAdminClient(), ctx.user!.id, ctx.workspace.id, noteId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/** Move note to trash. Blocked if it is the box's current guide note. */
export async function trashNoteAction(
  noteId: string
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    await trashNote(createAdminClient(), ctx.user!.id, ctx.workspace.id, noteId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/** Restore a trashed note to active. */
export async function restoreNoteAction(
  noteId: string
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    await restoreNote(createAdminClient(), ctx.user!.id, ctx.workspace.id, noteId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
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
