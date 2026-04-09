import { type SupabaseClient } from "@supabase/supabase-js";
import { type Note } from "@/server/domain/types/note";
import { type Folder } from "@/server/domain/types/folder";
import { type Box } from "@/server/domain/types/box";
import { getNoteById, updateNote } from "@/server/repositories/note_repository";
import { getFolderById } from "@/server/repositories/folder_repository";
import { getBoxById, updateBox } from "@/server/repositories/box_repository";
import {
  auditNoteArchived,
  auditNoteUnarchived,
  auditNoteTrashed,
  auditNoteRestored,
  auditFolderSubtreeArchived,
  auditFolderSubtreeUnarchived,
  auditFolderSubtreeTrashed,
  auditFolderSubtreeRestored,
  auditBoxArchived,
  auditBoxUnarchived,
} from "@/server/services/audit_service";

/**
 * Lifecycle service.
 *
 * Orchestrates archive, trash, restore, and unarchive for notes, folder
 * subtrees, and boxes. All operations enforce two-hop ownership
 * (resource → box → workspace_id) before mutating state.
 *
 * Guide note protection:
 *   A note that is currently assigned as a box's guide note (boxes.guide_note_id)
 *   cannot be trashed or archived. The owner must clear or change the guide note
 *   assignment first. This is enforced with explicit, legible error messages.
 *
 *   For folder subtree operations, if the subtree contains the current guide note
 *   the operation is rejected cleanly. guide_note_id is never silently cleared.
 *
 * Box trash: intentionally deferred in V1. See docs/lifecycle_controls_v1.md.
 */

// ─── Internal helpers ──────────────────────────────────────────────────────────

interface SubtreeRpcResult {
  folder_count: number;
  note_count: number;
}

async function resolveNoteWithOwnership(
  supabase: SupabaseClient,
  noteId: string,
  workspaceId: string
): Promise<{ note: Note; box: Box }> {
  const note = await getNoteById(supabase, noteId);
  if (!note) throw new Error("Note not found");

  const box = await getBoxById(supabase, note.box_id);
  if (!box || box.workspace_id !== workspaceId) throw new Error("Note not found");

  return { note, box };
}

async function resolveFolderWithOwnership(
  supabase: SupabaseClient,
  folderId: string,
  workspaceId: string
): Promise<{ folder: Folder; box: Box }> {
  const folder = await getFolderById(supabase, folderId);
  if (!folder) throw new Error("Folder not found");

  const box = await getBoxById(supabase, folder.box_id);
  if (!box || box.workspace_id !== workspaceId) throw new Error("Folder not found");

  return { folder, box };
}

async function resolveBoxWithOwnership(
  supabase: SupabaseClient,
  boxId: string,
  workspaceId: string
): Promise<Box> {
  const box = await getBoxById(supabase, boxId);
  if (!box || box.workspace_id !== workspaceId) throw new Error("Box not found");
  return box;
}

/**
 * Check whether a note is currently assigned as the guide note of any box.
 * Returns the box id if assigned, null otherwise.
 */
async function findGuideNoteAssignment(
  supabase: SupabaseClient,
  noteId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("boxes")
    .select("id")
    .eq("guide_note_id", noteId)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Check whether any note in the folder subtree is the current guide note of the box.
 * Returns the guide note id if found, null otherwise.
 */
async function findGuideNoteInSubtree(
  supabase: SupabaseClient,
  folderId: string,
  boxId: string,
  guideNoteId: string | null
): Promise<string | null> {
  if (!guideNoteId) return null;

  // Check if guide note lives in this subtree
  const { data } = await supabase
    .from("notes")
    .select("id, folder_id")
    .eq("id", guideNoteId)
    .eq("box_id", boxId)
    .maybeSingle();

  if (!data || !data.folder_id) return null;

  // Walk up from guide note's folder to see if folderId is an ancestor
  // We do this by fetching all folder ids in the subtree
  const { data: subtreeFolders } = await supabase.rpc(
    "get_folder_subtree_ids",
    { p_folder_id: folderId, p_box_id: boxId }
  );

  // Fallback: just check if the guide note is in a folder that could be in the subtree
  // We do a simpler approach: check direct folder_id match in subtree
  // Since we don't have a dedicated RPC for just ids, we use the service layer SQL approach
  // by checking if the guide note is inside any folder whose path_cache starts with the subtree root
  const rootFolder = await getFolderById(supabase, folderId);
  if (!rootFolder) return null;

  const { data: guideFolder } = await supabase
    .from("folders")
    .select("path_cache")
    .eq("id", data.folder_id)
    .single();

  if (!guideFolder) return null;

  // Guide note is in the subtree if its folder path starts with the root folder path
  if (
    guideFolder.path_cache === rootFolder.path_cache ||
    guideFolder.path_cache.startsWith(rootFolder.path_cache + "/")
  ) {
    return guideNoteId;
  }

  // Also check if the guide note is directly in the root folder
  const { data: guideInRoot } = await supabase
    .from("notes")
    .select("id")
    .eq("id", guideNoteId)
    .eq("folder_id", folderId)
    .maybeSingle();

  return guideInRoot ? guideNoteId : null;
}

// ─── Note lifecycle ───────────────────────────────────────────────────────────

export async function archiveNote(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  noteId: string
): Promise<Note> {
  const { note, box } = await resolveNoteWithOwnership(supabase, noteId, workspaceId);

  if (note.status === "archived") throw new Error("Note is already archived");
  if (note.status === "trashed") throw new Error("Cannot archive a trashed note");

  const guideBoxId = await findGuideNoteAssignment(supabase, noteId);
  if (guideBoxId) {
    throw new Error(
      "This note is the current guide note for a box. Clear the guide note assignment before archiving."
    );
  }

  const updated = await updateNote(supabase, noteId, { status: "archived" });
  if (!updated) throw new Error("Failed to archive note");

  await auditNoteArchived(supabase, workspaceId, userId, noteId, {
    title: note.title,
    box_id: box.id,
  });

  return updated;
}

export async function unarchiveNote(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  noteId: string
): Promise<Note> {
  const { note, box } = await resolveNoteWithOwnership(supabase, noteId, workspaceId);

  if (note.status !== "archived") throw new Error("Note is not archived");

  const updated = await updateNote(supabase, noteId, { status: "active" });
  if (!updated) throw new Error("Failed to unarchive note");

  await auditNoteUnarchived(supabase, workspaceId, userId, noteId, {
    title: note.title,
    box_id: box.id,
  });

  return updated;
}

export async function trashNote(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  noteId: string
): Promise<Note> {
  const { note, box } = await resolveNoteWithOwnership(supabase, noteId, workspaceId);

  if (note.status === "trashed") throw new Error("Note is already trashed");

  const guideBoxId = await findGuideNoteAssignment(supabase, noteId);
  if (guideBoxId) {
    throw new Error(
      "This note is the current guide note for a box. Clear the guide note assignment before trashing."
    );
  }

  const updated = await updateNote(supabase, noteId, { status: "trashed" });
  if (!updated) throw new Error("Failed to trash note");

  await auditNoteTrashed(supabase, workspaceId, userId, noteId, {
    title: note.title,
    box_id: box.id,
  });

  return updated;
}

export async function restoreNote(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  noteId: string
): Promise<Note> {
  const { note, box } = await resolveNoteWithOwnership(supabase, noteId, workspaceId);

  if (note.status !== "trashed") throw new Error("Note is not trashed");

  const updated = await updateNote(supabase, noteId, { status: "active" });
  if (!updated) throw new Error("Failed to restore note");

  await auditNoteRestored(supabase, workspaceId, userId, noteId, {
    title: note.title,
    box_id: box.id,
  });

  return updated;
}

// ─── Folder subtree lifecycle ─────────────────────────────────────────────────

export async function archiveFolder(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  folderId: string
): Promise<SubtreeRpcResult> {
  const { folder, box } = await resolveFolderWithOwnership(supabase, folderId, workspaceId);

  if (folder.status === "trashed") throw new Error("Cannot archive a trashed folder");

  // Guide note protection
  const guideNoteId = await findGuideNoteInSubtree(supabase, folderId, box.id, box.guide_note_id);
  if (guideNoteId) {
    throw new Error(
      "This folder contains the current guide note for the box. Clear the guide note assignment before archiving the folder."
    );
  }

  const { data, error } = await supabase.rpc("archive_folder_subtree", {
    p_folder_id: folderId,
    p_box_id: box.id,
  });

  if (error || !data) throw new Error(error?.message ?? "Failed to archive folder");

  const result = data as SubtreeRpcResult;
  await auditFolderSubtreeArchived(supabase, workspaceId, userId, folderId, {
    box_id: box.id,
    folder_name: folder.name,
    folder_count: result.folder_count,
    note_count: result.note_count,
  });

  return result;
}

export async function unarchiveFolder(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  folderId: string
): Promise<SubtreeRpcResult> {
  const { folder, box } = await resolveFolderWithOwnership(supabase, folderId, workspaceId);

  if (folder.status !== "archived") throw new Error("Folder is not archived");

  const { data, error } = await supabase.rpc("unarchive_folder_subtree", {
    p_folder_id: folderId,
    p_box_id: box.id,
  });

  if (error || !data) throw new Error(error?.message ?? "Failed to unarchive folder");

  const result = data as SubtreeRpcResult;
  await auditFolderSubtreeUnarchived(supabase, workspaceId, userId, folderId, {
    box_id: box.id,
    folder_name: folder.name,
    folder_count: result.folder_count,
    note_count: result.note_count,
  });

  return result;
}

export async function trashFolder(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  folderId: string
): Promise<SubtreeRpcResult> {
  const { folder, box } = await resolveFolderWithOwnership(supabase, folderId, workspaceId);

  if (folder.status === "trashed") throw new Error("Folder is already trashed");

  // Guide note protection
  const guideNoteId = await findGuideNoteInSubtree(supabase, folderId, box.id, box.guide_note_id);
  if (guideNoteId) {
    throw new Error(
      "This folder contains the current guide note for the box. Clear the guide note assignment before trashing the folder."
    );
  }

  const { data, error } = await supabase.rpc("trash_folder_subtree", {
    p_folder_id: folderId,
    p_box_id: box.id,
  });

  if (error || !data) throw new Error(error?.message ?? "Failed to trash folder");

  const result = data as SubtreeRpcResult;
  await auditFolderSubtreeTrashed(supabase, workspaceId, userId, folderId, {
    box_id: box.id,
    folder_name: folder.name,
    folder_count: result.folder_count,
    note_count: result.note_count,
  });

  return result;
}

export async function restoreFolder(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  folderId: string
): Promise<SubtreeRpcResult> {
  const { folder, box } = await resolveFolderWithOwnership(supabase, folderId, workspaceId);

  if (folder.status !== "trashed") throw new Error("Folder is not trashed");

  const { data, error } = await supabase.rpc("restore_folder_subtree", {
    p_folder_id: folderId,
    p_box_id: box.id,
  });

  if (error || !data) throw new Error(error?.message ?? "Failed to restore folder");

  const result = data as SubtreeRpcResult;
  await auditFolderSubtreeRestored(supabase, workspaceId, userId, folderId, {
    box_id: box.id,
    folder_name: folder.name,
    folder_count: result.folder_count,
    note_count: result.note_count,
  });

  return result;
}

// ─── Box lifecycle ────────────────────────────────────────────────────────────

export async function archiveBox(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  boxId: string
): Promise<{ folder_count: number; note_count: number }> {
  const box = await resolveBoxWithOwnership(supabase, boxId, workspaceId);

  if (box.status === "archived") throw new Error("Box is already archived");
  if (box.status === "trashed") throw new Error("Cannot archive a trashed box");

  const { data, error } = await supabase.rpc("archive_box_contents", {
    p_box_id: boxId,
  });

  if (error || !data) throw new Error(error?.message ?? "Failed to archive box");

  const result = data as { folder_count: number; note_count: number };
  await auditBoxArchived(supabase, workspaceId, userId, boxId, {
    box_name: box.name,
    folder_count: result.folder_count,
    note_count: result.note_count,
  });

  return result;
}

export async function unarchiveBox(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  boxId: string
): Promise<{ folder_count: number; note_count: number }> {
  const box = await resolveBoxWithOwnership(supabase, boxId, workspaceId);

  if (box.status !== "archived") throw new Error("Box is not archived");

  const { data, error } = await supabase.rpc("unarchive_box_contents", {
    p_box_id: boxId,
  });

  if (error || !data) throw new Error(error?.message ?? "Failed to unarchive box");

  const result = data as { folder_count: number; note_count: number };
  await auditBoxUnarchived(supabase, workspaceId, userId, boxId, {
    box_name: box.name,
    folder_count: result.folder_count,
    note_count: result.note_count,
  });

  return result;
}

// ─── Box trash: deferred ──────────────────────────────────────────────────────
//
// Box trash is intentionally not implemented in V1. A box trash operation
// would need to:
//   1. Verify no guide note conflict (the box has its own guide_note_id)
//   2. Cascade trash to all non-trashed folders and notes
//   3. Handle unarchive/restore in a coherent way
//
// This is feasible but adds complexity that is better tackled after archive
// and note/folder trash are well-established. A trashed box would also
// disappear from the sidebar, which requires explicit discovery UI.
//
// Use archiveBox as the reversible "hide this box" mechanism in V1.
