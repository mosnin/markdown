import { type SupabaseClient } from "@supabase/supabase-js";
import { type Box } from "@/server/domain/types/box";
import { getNoteById } from "@/server/repositories/note_repository";
import { updateBox } from "@/server/repositories/box_repository";
import { getBoxForWorkspace } from "@/server/services/box_service";
import {
  auditGuideNoteAssigned,
  auditGuideNoteCleared,
} from "@/server/services/audit_service";

/**
 * Guide service.
 *
 * boxes.guide_note_id is the ONLY canonical pointer to a box's guide note.
 * This service is the authoritative path for setting and clearing it.
 *
 * Constraints enforced:
 * - The note must exist and belong to the same box.
 * - The user must own the workspace that owns the box.
 */

export async function assignGuideNote(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  boxId: string,
  noteId: string
): Promise<Box> {
  // Verify box ownership
  const box = await getBoxForWorkspace(supabase, boxId, workspaceId);
  if (!box) throw new Error("Box not found");

  // Verify the note exists and belongs to this box
  const note = await getNoteById(supabase, noteId);
  if (!note || note.box_id !== boxId) {
    throw new Error("Note not found in this box");
  }

  // Refuse to point a box at a note that has been soft-removed. A
  // trashed or archived note is semantically invisible to most readers
  // and making it the guide note would surface a dead pointer.
  if (note.status === "trashed" || note.status === "archived") {
    throw new Error("Cannot assign a trashed or archived note as guide note");
  }

  const updated = await updateBox(supabase, boxId, { guide_note_id: noteId });
  if (!updated) throw new Error("Failed to assign guide note");

  await auditGuideNoteAssigned(
    supabase,
    workspaceId,
    userId,
    boxId,
    noteId,
    note.title
  );
  return updated;
}

export async function clearGuideNote(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  boxId: string
): Promise<Box> {
  const box = await getBoxForWorkspace(supabase, boxId, workspaceId);
  if (!box) throw new Error("Box not found");

  const updated = await updateBox(supabase, boxId, { guide_note_id: null });
  if (!updated) throw new Error("Failed to clear guide note");

  await auditGuideNoteCleared(supabase, workspaceId, userId, boxId);
  return updated;
}
