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

/** Bundle assembled and read by an external connection (actor_type = 'connection'). */
export function auditBundleReadByConnection(
  supabase: SupabaseClient,
  workspaceId: string,
  connectionId: string,
  noteId: string,
  metadata: {
    box_id: string;
    linked_count: number;
    guide_included: boolean;
    ancestor_summary_included: boolean;
    truncated: boolean;
  }
): Promise<void> {
  return writeConnection(supabase, workspaceId, connectionId, "note", noteId, "bundle.read", metadata);
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
    target_object_type?: string | null;
    target_object_id?: string | null;
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
    object_type?: string | null;
    object_id?: string | null;
    version_id?: string | null;
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

// ─── Lifecycle events ─────────────────────────────────────────────────────────

export function auditNoteArchived(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  noteId: string,
  metadata: { title: string; box_id: string }
): Promise<void> {
  return write(supabase, workspaceId, userId, "note", noteId, "note.archived", metadata);
}

export function auditNoteUnarchived(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  noteId: string,
  metadata: { title: string; box_id: string }
): Promise<void> {
  return write(supabase, workspaceId, userId, "note", noteId, "note.unarchived", metadata);
}

export function auditNoteTrashed(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  noteId: string,
  metadata: { title: string; box_id: string }
): Promise<void> {
  return write(supabase, workspaceId, userId, "note", noteId, "note.trashed", metadata);
}

export function auditNoteRestored(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  noteId: string,
  metadata: { title: string; box_id: string }
): Promise<void> {
  return write(supabase, workspaceId, userId, "note", noteId, "note.restored", metadata);
}

export function auditFolderSubtreeArchived(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  folderId: string,
  metadata: { box_id: string; folder_name: string; folder_count: number; note_count: number }
): Promise<void> {
  return write(supabase, workspaceId, userId, "folder", folderId, "folder.subtree_archived", metadata);
}

export function auditFolderSubtreeUnarchived(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  folderId: string,
  metadata: { box_id: string; folder_name: string; folder_count: number; note_count: number }
): Promise<void> {
  return write(supabase, workspaceId, userId, "folder", folderId, "folder.subtree_unarchived", metadata);
}

export function auditFolderSubtreeTrashed(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  folderId: string,
  metadata: { box_id: string; folder_name: string; folder_count: number; note_count: number }
): Promise<void> {
  return write(supabase, workspaceId, userId, "folder", folderId, "folder.subtree_trashed", metadata);
}

export function auditFolderSubtreeRestored(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  folderId: string,
  metadata: { box_id: string; folder_name: string; folder_count: number; note_count: number }
): Promise<void> {
  return write(supabase, workspaceId, userId, "folder", folderId, "folder.subtree_restored", metadata);
}

export function auditBoxArchived(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  boxId: string,
  metadata: { box_name: string; folder_count: number; note_count: number }
): Promise<void> {
  return write(supabase, workspaceId, userId, "box", boxId, "box.archived", metadata);
}

export function auditBoxUnarchived(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  boxId: string,
  metadata: { box_name: string; folder_count: number; note_count: number }
): Promise<void> {
  return write(supabase, workspaceId, userId, "box", boxId, "box.unarchived", metadata);
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

// ─── Template events ─────────────────────────────────────────────────────────

/**
 * Box template applied — fired once per applyBoxTemplate call after all
 * folders and notes are created.
 */
export function auditBoxTemplateApplied(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  boxId: string,
  metadata: { template_id: string; folder_count: number; note_count: number }
): Promise<void> {
  return write(supabase, workspaceId, userId, "box", boxId, "box.template_applied", metadata);
}

/**
 * Note created from a starter template — fired in addition to note.created
 * when createNoteAction is called with a templateId.
 */
export function auditNoteCreatedFromTemplate(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  noteId: string,
  metadata: { template_id: string; title: string; box_id: string }
): Promise<void> {
  return write(supabase, workspaceId, userId, "note", noteId, "note.template_applied", metadata);
}

/**
 * Generated note promoted to a standard user-managed note (actor_type = 'user').
 * Fired after is_generated is cleared and the promotion version is created.
 */
export function auditGeneratedNotePromoted(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  noteId: string,
  metadata: {
    title: string;
    box_id: string;
    generated_by_connection_id: string | null;
  }
): Promise<void> {
  return write(supabase, workspaceId, userId, "note", noteId, "note.promoted_from_generated", metadata);
}

// ─── File, Skill, Agent lifecycle events ─────────────────────────────────────

/**
 * Generic lifecycle events for files, skills, and agents.
 * object_type: 'file' | 'skill' | 'agent'
 */

export function auditObjectArchived(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  metadata: { name: string; box_id: string | null; is_reusable: boolean }
): Promise<void> {
  return write(supabase, workspaceId, userId, objectType, objectId, `${objectType}.archived`, metadata);
}

export function auditObjectUnarchived(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  metadata: { name: string; box_id: string | null; is_reusable: boolean }
): Promise<void> {
  return write(supabase, workspaceId, userId, objectType, objectId, `${objectType}.unarchived`, metadata);
}

export function auditObjectTrashed(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  metadata: { name: string; box_id: string | null; is_reusable: boolean }
): Promise<void> {
  return write(supabase, workspaceId, userId, objectType, objectId, `${objectType}.trashed`, metadata);
}

export function auditObjectRestored(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  metadata: { name: string; box_id: string | null; is_reusable: boolean }
): Promise<void> {
  return write(supabase, workspaceId, userId, objectType, objectId, `${objectType}.restored`, metadata);
}

export function auditObjectCreated(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  metadata: { name: string; box_id: string | null; is_reusable: boolean; canonical_format: string }
): Promise<void> {
  return write(supabase, workspaceId, userId, objectType, objectId, `${objectType}.created`, metadata);
}

export function auditObjectUpdated(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  metadata: {
    name: string;
    box_id: string | null;
    is_reusable: boolean;
    version_id?: string | null;
    diff_summary?: Record<string, unknown> | null;
  }
): Promise<void> {
  return write(supabase, workspaceId, userId, objectType, objectId, `${objectType}.updated`, metadata);
}

export function auditObjectExported(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  metadata: { name: string; export_mode: string }
): Promise<void> {
  return write(supabase, workspaceId, userId, objectType, objectId, `${objectType}.exported`, metadata);
}

export function auditObjectImported(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  metadata: { name: string; is_reusable: boolean; collision_mode: string }
): Promise<void> {
  return write(supabase, workspaceId, userId, objectType, objectId, `${objectType}.imported`, metadata);
}

// ─── Object version rollback events ──────────────────────────────────────────

export function auditObjectRollback(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  metadata: {
    prior_version_id: string | null;
    restored_from_version_id: string;
    new_version_id: string;
    name: string;
    is_reusable: boolean;
  }
): Promise<void> {
  return write(supabase, workspaceId, userId, objectType, objectId, `${objectType}.rollback`, metadata);
}

// ─── Box object attachment events (reusable references) ──────────────────────

export function auditReusableObjectAttached(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  objectType: "skill" | "agent",
  objectId: string,
  metadata: {
    object_name: string;
    box_id: string;
    box_name: string;
    folder_id: string | null;
  }
): Promise<void> {
  return write(supabase, workspaceId, userId, objectType, objectId, `${objectType}.attached_to_box`, metadata);
}

export function auditReusableObjectDetached(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  objectType: "skill" | "agent",
  objectId: string,
  metadata: {
    object_name: string;
    box_id: string;
    box_name: string;
  }
): Promise<void> {
  return write(supabase, workspaceId, userId, objectType, objectId, `${objectType}.detached_from_box`, metadata);
}

// ─── Extended write proposal events for object targets ───────────────────────

/**
 * Write proposal approved by the workspace owner, targeting a file/skill/agent.
 * Extends auditWriteProposalApproved with object metadata.
 */
export function auditObjectProposalApproved(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  proposalId: string,
  metadata: {
    proposal_type: string;
    connection_id: string;
    object_type: string | null;
    object_id: string | null;
    version_id?: string | null;
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

// ─── MCP (OAuth-primary) audit write ─────────────────────────────────────────

/**
 * Canonical audit write for MCP-originated events.
 *
 * Records the human user as the actor (actor_type='user', actor_id=
 * userId) and stamps the OAuth client_id + auth source into metadata.
 * This is the correct attribution shape for OAuth-backed activity:
 * the user is the authority, the client is the channel.
 *
 * For true legacy (csk_v1_) machine-only paths, continue calling
 * `writeConnection` (internal, not exported) or the specific
 * auditConnection* helpers — those retain actor_type='connection'
 * because no human user is on record.
 *
 * Event-type convention: "mcp.<object_type>.<verb>" or the existing
 * feature-specific event names (e.g. "note.created") when the MCP
 * layer delegates to service code that already audits itself.
 */
export async function auditMcp(
  supabase: SupabaseClient,
  event: {
    workspaceId: string;
    userId: string;
    clientId: string | null;
    connectionId?: string | null;
    source: "oauth" | "legacy_csk";
    objectType: string;
    objectId: string;
    eventType: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const {
    workspaceId,
    userId,
    clientId,
    connectionId,
    source,
    objectType,
    objectId,
    eventType,
  } = event;
  try {
    await createAuditEvent(supabase, {
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: userId,
      object_type: objectType,
      object_id: objectId,
      event_type: eventType,
      metadata: {
        ...(event.metadata ?? {}),
        auth_source: source,
        ...(clientId ? { oauth_client_id: clientId } : {}),
        ...(connectionId ? { connection_id: connectionId } : {}),
      },
    });
  } catch (err) {
    console.error(`[audit] auditMcp failed for ${eventType}`, err);
  }
}
