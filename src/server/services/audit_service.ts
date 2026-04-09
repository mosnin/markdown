import { type SupabaseClient } from "@supabase/supabase-js";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

/**
 * Internal helper — all audit writes go through this.
 * Errors are swallowed: audit failure must not abort the primary operation.
 */
async function write(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  objectType: string,
  objectId: string,
  eventType: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await createAuditEvent(supabase, {
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: actorId,
      object_type: objectType,
      object_id: objectId,
      event_type: eventType,
      metadata: metadata ?? null,
    });
  } catch (err) {
    console.error(`[audit] Failed to write ${eventType} for ${objectType}/${objectId}`, err);
  }
}

// ─── Box events ───────────────────────────────────────────────────────────────

export function auditBoxCreated(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  boxId: string,
  boxName: string
): Promise<void> {
  return write(supabase, workspaceId, actorId, "box", boxId, "box.created", {
    name: boxName,
  });
}

export function auditBoxUpdated(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  boxId: string,
  changes: Record<string, unknown>
): Promise<void> {
  return write(supabase, workspaceId, actorId, "box", boxId, "box.updated", changes);
}

// ─── Folder events ────────────────────────────────────────────────────────────

export function auditFolderCreated(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  folderId: string,
  folderName: string,
  boxId: string
): Promise<void> {
  return write(supabase, workspaceId, actorId, "folder", folderId, "folder.created", {
    name: folderName,
    box_id: boxId,
  });
}

export function auditFolderRenamed(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  folderId: string,
  oldName: string,
  newName: string
): Promise<void> {
  return write(supabase, workspaceId, actorId, "folder", folderId, "folder.renamed", {
    old_name: oldName,
    new_name: newName,
  });
}

// ─── Note events ──────────────────────────────────────────────────────────────

export function auditNoteCreated(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  noteId: string,
  noteTitle: string,
  boxId: string,
  kind: string
): Promise<void> {
  return write(supabase, workspaceId, actorId, "note", noteId, "note.created", {
    title: noteTitle,
    box_id: boxId,
    kind,
  });
}

export function auditNoteUpdated(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  noteId: string,
  noteTitle: string
): Promise<void> {
  return write(supabase, workspaceId, actorId, "note", noteId, "note.updated", {
    title: noteTitle,
  });
}

// ─── Context bundle events ────────────────────────────────────────────────────

export function auditBundleRead(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  noteId: string,
  metadata: {
    box_id: string;
    linked_count: number;
    guide_included: boolean;
    ancestor_summary_included: boolean;
    truncated: boolean;
  }
): Promise<void> {
  return write(supabase, workspaceId, actorId, "note", noteId, "bundle.read", metadata);
}

// ─── Note link events ────────────────────────────────────────────────────────

export function auditNoteLinkCreated(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  linkId: string,
  sourceNoteId: string,
  targetNoteId: string,
  relationshipType: string
): Promise<void> {
  return write(supabase, workspaceId, actorId, "note_link", linkId, "note_link.created", {
    source_note_id: sourceNoteId,
    target_note_id: targetNoteId,
    relationship_type: relationshipType,
  });
}

export function auditNoteLinkDeleted(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  linkId: string,
  sourceNoteId: string,
  targetNoteId: string
): Promise<void> {
  return write(supabase, workspaceId, actorId, "note_link", linkId, "note_link.deleted", {
    source_note_id: sourceNoteId,
    target_note_id: targetNoteId,
  });
}

// ─── Guide note events ────────────────────────────────────────────────────────

export function auditGuideNoteAssigned(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  boxId: string,
  noteId: string,
  noteTitle: string
): Promise<void> {
  return write(supabase, workspaceId, actorId, "box", boxId, "guide_note.assigned", {
    note_id: noteId,
    note_title: noteTitle,
  });
}

export function auditGuideNoteCleared(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  boxId: string
): Promise<void> {
  return write(supabase, workspaceId, actorId, "box", boxId, "guide_note.cleared", {});
}
