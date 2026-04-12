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
  auditObjectArchived,
  auditObjectUnarchived,
  auditObjectTrashed,
  auditObjectRestored,
} from "@/server/services/audit_service";

/**
 * Lifecycle service.
 *
 * Orchestrates archive, trash, restore, and unarchive for all object types:
 *   - Notes, Folders (subtrees), Boxes
 *   - Files, Skills, Agents (new in extended object model)
 *
 * All operations enforce two-hop ownership (resource → box → workspace_id,
 * or for reusable objects: resource.workspace_id match).
 *
 * Guide note protection (Notes only):
 *   A note assigned as a box's guide note cannot be trashed or archived.
 *   guide_note_id is never silently cleared.
 *
 * Reusable shared object behavior on archive/trash:
 *   When a workspace-reusable skill or agent is archived or trashed, any
 *   existing box_object_attachments remain. The attachment rows are NOT
 *   silently removed. The UI and tree rendering layer is responsible for
 *   surfacing the degraded state (e.g. showing a "degraded" badge on
 *   attached references when the source object is non-active).
 *   This is an explicit, deliberate design decision documented in
 *   docs/expanded_object_trust_model_v1.md.
 *
 * Lifecycle states and transitions:
 *   active ←→ archived
 *   active → trashed → active (restore)
 *   archived → trashed (allowed)
 *   trashed → archived (not allowed: restore first)
 *
 * Box trash: intentionally deferred in V1. Use archiveBox as the reversible
 * "hide this box" mechanism.
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
  if (!folder.box_id) throw new Error("Folder has no box");

  const box = await getBoxById(supabase, folder.box_id!);
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
 * Resolve a file/skill/agent row and verify workspace ownership.
 *
 * Reusable objects (is_reusable=true) have box_id=null; ownership is verified
 * directly by workspace_id.
 *
 * Box-local objects use the two-hop check (object → box → workspace_id).
 */
async function resolveObjectWithOwnership(
  supabase: SupabaseClient,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  workspaceId: string
): Promise<{
  id: string;
  name: string;
  status: string;
  box_id: string | null;
  is_reusable: boolean;
}> {
  const table = objectType === "file" ? "files" : objectType === "skill" ? "skills" : "agents";

  const { data, error } = await supabase
    .from(table)
    .select("id, name, status, box_id, is_reusable, workspace_id")
    .eq("id", objectId)
    .single();

  if (error || !data) throw new Error(`${objectType} not found`);

  const row = data as {
    id: string;
    name: string;
    status: string;
    box_id: string | null;
    is_reusable: boolean;
    workspace_id: string;
  };

  if (row.workspace_id !== workspaceId) throw new Error(`${objectType} not found`);

  if (!row.is_reusable && row.box_id) {
    const box = await getBoxById(supabase, row.box_id);
    if (!box || box.workspace_id !== workspaceId) throw new Error(`${objectType} not found`);
  }

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    box_id: row.box_id,
    is_reusable: row.is_reusable,
  };
}

async function updateObjectStatus(
  supabase: SupabaseClient,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  status: string
): Promise<void> {
  const table = objectType === "file" ? "files" : objectType === "skill" ? "skills" : "agents";
  const { error } = await supabase
    .from(table)
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", objectId);
  if (error) throw new Error(error.message);
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
 */
async function findGuideNoteInSubtree(
  supabase: SupabaseClient,
  folderId: string,
  boxId: string,
  guideNoteId: string | null
): Promise<string | null> {
  if (!guideNoteId) return null;

  const { data } = await supabase
    .from("notes")
    .select("id, folder_id")
    .eq("id", guideNoteId)
    .eq("box_id", boxId)
    .maybeSingle();

  if (!data || !data.folder_id) return null;

  const rootFolder = await getFolderById(supabase, folderId);
  if (!rootFolder) return null;

  const { data: guideFolder } = await supabase
    .from("folders")
    .select("path_cache")
    .eq("id", data.folder_id)
    .single();

  if (!guideFolder) return null;

  if (
    guideFolder.path_cache === rootFolder.path_cache ||
    guideFolder.path_cache.startsWith(rootFolder.path_cache + "/")
  ) {
    return guideNoteId;
  }

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

// ─── File lifecycle ───────────────────────────────────────────────────────────

export async function archiveFile(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  fileId: string
): Promise<void> {
  const obj = await resolveObjectWithOwnership(supabase, "file", fileId, workspaceId);

  if (obj.status === "archived") throw new Error("File is already archived");
  if (obj.status === "trashed") throw new Error("Cannot archive a trashed file");

  await updateObjectStatus(supabase, "file", fileId, "archived");

  await auditObjectArchived(supabase, workspaceId, userId, "file", fileId, {
    name: obj.name,
    box_id: obj.box_id,
    is_reusable: false,
  });
}

export async function unarchiveFile(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  fileId: string
): Promise<void> {
  const obj = await resolveObjectWithOwnership(supabase, "file", fileId, workspaceId);

  if (obj.status !== "archived") throw new Error("File is not archived");

  await updateObjectStatus(supabase, "file", fileId, "active");

  await auditObjectUnarchived(supabase, workspaceId, userId, "file", fileId, {
    name: obj.name,
    box_id: obj.box_id,
    is_reusable: false,
  });
}

export async function trashFile(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  fileId: string
): Promise<void> {
  const obj = await resolveObjectWithOwnership(supabase, "file", fileId, workspaceId);

  if (obj.status === "trashed") throw new Error("File is already trashed");

  await updateObjectStatus(supabase, "file", fileId, "trashed");

  await auditObjectTrashed(supabase, workspaceId, userId, "file", fileId, {
    name: obj.name,
    box_id: obj.box_id,
    is_reusable: false,
  });
}

export async function restoreFile(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  fileId: string
): Promise<void> {
  const obj = await resolveObjectWithOwnership(supabase, "file", fileId, workspaceId);

  if (obj.status !== "trashed") throw new Error("File is not trashed");

  await updateObjectStatus(supabase, "file", fileId, "active");

  await auditObjectRestored(supabase, workspaceId, userId, "file", fileId, {
    name: obj.name,
    box_id: obj.box_id,
    is_reusable: false,
  });
}

// ─── Skill lifecycle ──────────────────────────────────────────────────────────
//
// Note: when a reusable skill is archived or trashed, box_object_attachments
// are NOT automatically removed. The attachment rows remain. The UI renders
// a degraded state indicator on any attached reference whose source object
// is non-active. The human owner must explicitly detach or restore.

export async function archiveSkill(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  skillId: string
): Promise<void> {
  const obj = await resolveObjectWithOwnership(supabase, "skill", skillId, workspaceId);

  if (obj.status === "archived") throw new Error("Skill is already archived");
  if (obj.status === "trashed") throw new Error("Cannot archive a trashed skill");

  await updateObjectStatus(supabase, "skill", skillId, "archived");

  await auditObjectArchived(supabase, workspaceId, userId, "skill", skillId, {
    name: obj.name,
    box_id: obj.box_id,
    is_reusable: obj.is_reusable,
  });
}

export async function unarchiveSkill(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  skillId: string
): Promise<void> {
  const obj = await resolveObjectWithOwnership(supabase, "skill", skillId, workspaceId);

  if (obj.status !== "archived") throw new Error("Skill is not archived");

  await updateObjectStatus(supabase, "skill", skillId, "active");

  await auditObjectUnarchived(supabase, workspaceId, userId, "skill", skillId, {
    name: obj.name,
    box_id: obj.box_id,
    is_reusable: obj.is_reusable,
  });
}

export async function trashSkill(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  skillId: string
): Promise<void> {
  const obj = await resolveObjectWithOwnership(supabase, "skill", skillId, workspaceId);

  if (obj.status === "trashed") throw new Error("Skill is already trashed");

  await updateObjectStatus(supabase, "skill", skillId, "trashed");

  await auditObjectTrashed(supabase, workspaceId, userId, "skill", skillId, {
    name: obj.name,
    box_id: obj.box_id,
    is_reusable: obj.is_reusable,
  });
}

export async function restoreSkill(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  skillId: string
): Promise<void> {
  const obj = await resolveObjectWithOwnership(supabase, "skill", skillId, workspaceId);

  if (obj.status !== "trashed") throw new Error("Skill is not trashed");

  await updateObjectStatus(supabase, "skill", skillId, "active");

  await auditObjectRestored(supabase, workspaceId, userId, "skill", skillId, {
    name: obj.name,
    box_id: obj.box_id,
    is_reusable: obj.is_reusable,
  });
}

// ─── Agent lifecycle ──────────────────────────────────────────────────────────

export async function archiveAgent(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  agentId: string
): Promise<void> {
  const obj = await resolveObjectWithOwnership(supabase, "agent", agentId, workspaceId);

  if (obj.status === "archived") throw new Error("Agent is already archived");
  if (obj.status === "trashed") throw new Error("Cannot archive a trashed agent");

  await updateObjectStatus(supabase, "agent", agentId, "archived");

  await auditObjectArchived(supabase, workspaceId, userId, "agent", agentId, {
    name: obj.name,
    box_id: obj.box_id,
    is_reusable: obj.is_reusable,
  });
}

export async function unarchiveAgent(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  agentId: string
): Promise<void> {
  const obj = await resolveObjectWithOwnership(supabase, "agent", agentId, workspaceId);

  if (obj.status !== "archived") throw new Error("Agent is not archived");

  await updateObjectStatus(supabase, "agent", agentId, "active");

  await auditObjectUnarchived(supabase, workspaceId, userId, "agent", agentId, {
    name: obj.name,
    box_id: obj.box_id,
    is_reusable: obj.is_reusable,
  });
}

export async function trashAgent(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  agentId: string
): Promise<void> {
  const obj = await resolveObjectWithOwnership(supabase, "agent", agentId, workspaceId);

  if (obj.status === "trashed") throw new Error("Agent is already trashed");

  await updateObjectStatus(supabase, "agent", agentId, "trashed");

  await auditObjectTrashed(supabase, workspaceId, userId, "agent", agentId, {
    name: obj.name,
    box_id: obj.box_id,
    is_reusable: obj.is_reusable,
  });
}

export async function restoreAgent(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  agentId: string
): Promise<void> {
  const obj = await resolveObjectWithOwnership(supabase, "agent", agentId, workspaceId);

  if (obj.status !== "trashed") throw new Error("Agent is not trashed");

  await updateObjectStatus(supabase, "agent", agentId, "active");

  await auditObjectRestored(supabase, workspaceId, userId, "agent", agentId, {
    name: obj.name,
    box_id: obj.box_id,
    is_reusable: obj.is_reusable,
  });
}

// ─── Box trash: deferred ──────────────────────────────────────────────────────
//
// Box trash is intentionally not implemented in V1. Use archiveBox as the
// reversible "hide this box" mechanism in V1.
