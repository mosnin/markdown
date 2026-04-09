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

/** Connection-actor variant — writes event with actor_type='connection'. */
async function writeConnection(
  supabase: SupabaseClient,
  workspaceId: string,
  connectionId: string,
  objectType: string,
  objectId: string,
  eventType: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await createAuditEvent(supabase, {
      workspace_id: workspaceId,
      actor_type: "connection",
      actor_id: connectionId,
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

// ─── Export events ────────────────────────────────────────────────────────────

export function auditNoteExported(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  noteId: string
): Promise<void> {
  return write(supabase, workspaceId, actorId, "note", noteId, "note.exported", {});
}

export function auditFolderExported(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  folderId: string,
  metadata: { note_count: number }
): Promise<void> {
  return write(supabase, workspaceId, actorId, "folder", folderId, "folder.exported", metadata);
}

export function auditBoxExported(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  boxId: string,
  metadata: { note_count: number; folder_count: number }
): Promise<void> {
  return write(supabase, workspaceId, actorId, "box", boxId, "box.exported", metadata);
}

export function auditBundleExported(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  noteId: string,
  metadata: { note_count: number; truncated: boolean }
): Promise<void> {
  return write(supabase, workspaceId, actorId, "note", noteId, "bundle.exported", metadata);
}

export function auditImportCompleted(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  boxId: string,
  metadata: {
    collision_mode: string;
    created_notes: number;
    created_folders: number;
    created_links: number;
    warnings: number;
  }
): Promise<void> {
  return write(supabase, workspaceId, actorId, "box", boxId, "import.completed", metadata);
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

// ─── Connection events ────────────────────────────────────────────────────────

export function auditConnectionCreated(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  connectionId: string,
  metadata: { name: string; permission_mode: string }
): Promise<void> {
  return write(
    supabase,
    workspaceId,
    actorId,
    "connection",
    connectionId,
    "connection.created",
    metadata
  );
}

export function auditConnectionRevoked(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  connectionId: string,
  metadata: { name: string }
): Promise<void> {
  return write(
    supabase,
    workspaceId,
    actorId,
    "connection",
    connectionId,
    "connection.revoked",
    metadata
  );
}

export function auditConnectionUpdated(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  connectionId: string,
  metadata: { name: string }
): Promise<void> {
  return write(
    supabase,
    workspaceId,
    actorId,
    "connection",
    connectionId,
    "connection.updated",
    metadata
  );
}

export function auditTokenRotated(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  connectionId: string
): Promise<void> {
  return write(
    supabase,
    workspaceId,
    actorId,
    "connection",
    connectionId,
    "connection.token_rotated"
  );
}

// ─── Write proposal events ────────────────────────────────────────────────────

/** Proposal created by a connection (actor_type = 'connection'). */
export function auditWriteProposalCreated(
  supabase: SupabaseClient,
  workspaceId: string,
  connectionId: string,
  proposalId: string,
  metadata: {
    proposal_type: string;
    target_note_id?: string | null;
    target_folder_id?: string | null;
    box_id?: string | null;
  }
): Promise<void> {
  return writeConnection(
    supabase,
    workspaceId,
    connectionId,
    "write_proposal",
    proposalId,
    "write_proposal.created",
    metadata
  );
}

/** Proposal approved by the workspace owner (actor_type = 'user'). */
export function auditWriteProposalApproved(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  proposalId: string,
  metadata: {
    proposal_type: string;
    connection_id: string;
    note_id?: string | null;
  }
): Promise<void> {
  return write(
    supabase,
    workspaceId,
    userId,
    "write_proposal",
    proposalId,
    "write_proposal.approved",
    metadata
  );
}

/** Proposal rejected by the workspace owner (actor_type = 'user'). */
export function auditWriteProposalRejected(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  proposalId: string,
  metadata: { proposal_type: string; connection_id: string }
): Promise<void> {
  return write(
    supabase,
    workspaceId,
    userId,
    "write_proposal",
    proposalId,
    "write_proposal.rejected",
    metadata
  );
}

/** Proposal marked conflicted during approval (actor_type = 'user'). */
export function auditWriteProposalConflicted(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  proposalId: string,
  metadata: { proposal_type: string; connection_id: string; reason: string }
): Promise<void> {
  return write(
    supabase,
    workspaceId,
    userId,
    "write_proposal",
    proposalId,
    "write_proposal.conflicted",
    metadata
  );
}

// ─── Generated folder policy events ──────────────────────────────────────────

export function auditGeneratedFolderPolicyChanged(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  folderId: string,
  metadata: { box_id: string; accepts_generated_notes: boolean }
): Promise<void> {
  return write(
    supabase,
    workspaceId,
    userId,
    "folder",
    folderId,
    "folder.generated_policy_changed",
    metadata
  );
}

// ─── Version history events ───────────────────────────────────────────────────

export function auditNoteRollback(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  noteId: string,
  metadata: {
    prior_version_id: string | null;
    restored_from_version_id: string;
    new_version_id: string;
    box_id: string;
  }
): Promise<void> {
  return write(supabase, workspaceId, userId, "note", noteId, "note.rollback", metadata);
}

// ─── Generated note events ────────────────────────────────────────────────────

/** Generated note created directly by a connection (actor_type = 'connection'). */
export function auditGeneratedNoteCreated(
  supabase: SupabaseClient,
  workspaceId: string,
  connectionId: string,
  noteId: string,
  metadata: { title: string; box_id: string; folder_id: string }
): Promise<void> {
  return writeConnection(
    supabase,
    workspaceId,
    connectionId,
    "note",
    noteId,
    "note.generated",
    metadata
  );
}
