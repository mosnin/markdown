import { type SupabaseClient } from "@supabase/supabase-js";
import { type NoteLink } from "@/server/domain/types/note_link";
import { type RelationshipType } from "@/server/domain/constants/note_constants";
import {
  getNoteLinkById,
  listLinksFromNote,
  listLinksToNote,
  createNoteLink,
  deleteNoteLink,
} from "@/server/repositories/note_link_repository";
import { getNoteById } from "@/server/repositories/note_repository";
import {
  auditNoteLinkCreated,
  auditNoteLinkDeleted,
} from "@/server/services/audit_service";

/**
 * Link service.
 *
 * Enforces same-box constraint (cannot be expressed as a DB CHECK).
 * Links have no UPDATE — changing relationship_type is delete + re-insert.
 * Self-links are rejected by the database CHECK constraint.
 */

export interface LinkedNoteSet {
  outgoing: NoteLink[];
  incoming: NoteLink[];
}

// ─── Validation helper ────────────────────────────────────────────────────────

async function resolveAndValidateNotes(
  supabase: SupabaseClient,
  sourceNoteId: string,
  targetNoteId: string
): Promise<{ sourceBoxId: string }> {
  if (sourceNoteId === targetNoteId) {
    throw new Error("A note cannot link to itself");
  }

  const [source, target] = await Promise.all([
    getNoteById(supabase, sourceNoteId),
    getNoteById(supabase, targetNoteId),
  ]);

  if (!source) throw new Error("Source note not found");
  if (!target) throw new Error("Target note not found");
  if (source.box_id !== target.box_id) {
    throw new Error("Notes must be in the same box to be linked");
  }

  return { sourceBoxId: source.box_id };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * List all links for a note — both directions.
 */
export async function listLinksForNote(
  supabase: SupabaseClient,
  noteId: string
): Promise<LinkedNoteSet> {
  const [outgoing, incoming] = await Promise.all([
    listLinksFromNote(supabase, noteId),
    listLinksToNote(supabase, noteId),
  ]);
  return { outgoing, incoming };
}

/**
 * Create a directed link between two notes in the same box.
 */
export async function createLink(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  {
    sourceNoteId,
    targetNoteId,
    relationshipType,
  }: {
    sourceNoteId: string;
    targetNoteId: string;
    relationshipType: RelationshipType;
  }
): Promise<NoteLink> {
  await resolveAndValidateNotes(supabase, sourceNoteId, targetNoteId);

  const link = await createNoteLink(supabase, {
    source_note_id: sourceNoteId,
    target_note_id: targetNoteId,
    relationship_type: relationshipType,
  });

  await auditNoteLinkCreated(
    supabase,
    workspaceId,
    userId,
    link.id,
    sourceNoteId,
    targetNoteId,
    relationshipType
  );

  return link;
}

/**
 * Change a link's relationship_type.
 * Implemented as delete + re-insert (no UPDATE policy on note_links).
 */
export async function updateLinkRelationshipType(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  linkId: string,
  newRelationshipType: RelationshipType
): Promise<NoteLink> {
  const existing = await getNoteLinkById(supabase, linkId);
  if (!existing) throw new Error("Link not found");

  // Delete old link
  await deleteNoteLink(supabase, linkId);

  // Re-insert with new relationship_type
  const replacement = await createNoteLink(supabase, {
    source_note_id: existing.source_note_id,
    target_note_id: existing.target_note_id,
    relationship_type: newRelationshipType,
  });

  await auditNoteLinkCreated(
    supabase,
    workspaceId,
    userId,
    replacement.id,
    existing.source_note_id,
    existing.target_note_id,
    newRelationshipType
  );

  return replacement;
}

/**
 * Delete a note link by id.
 */
export async function deleteLink(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  linkId: string
): Promise<void> {
  const link = await getNoteLinkById(supabase, linkId);
  if (!link) throw new Error("Link not found");

  const deleted = await deleteNoteLink(supabase, linkId);
  if (!deleted) throw new Error("Failed to delete link");

  await auditNoteLinkDeleted(
    supabase,
    workspaceId,
    userId,
    linkId,
    link.source_note_id,
    link.target_note_id
  );
}
