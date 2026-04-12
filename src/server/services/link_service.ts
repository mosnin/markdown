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
 * Self-links are rejected by the database CHECK constraint.
 *
 * Update semantics: there is no UPDATE on note_links. Changing relationship_type
 * or relationship_note is delete + re-insert. The updateLink function handles
 * this transparently, preserving unchanged fields.
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
    relationshipNote,
    changeSetId,
  }: {
    sourceNoteId: string;
    targetNoteId: string;
    relationshipType: RelationshipType;
    relationshipNote?: string | null;
    /**
     * Optional change set correlation. When provided, the link
     * creation is recorded as a change_set_item with
     * operation='link_create' so restoring the change set reverses
     * the link. Callers that don't care about rollback grouping can
     * omit it.
     */
    changeSetId?: string | null;
  }
): Promise<NoteLink> {
  await resolveAndValidateNotes(supabase, sourceNoteId, targetNoteId);

  const link = await createNoteLink(supabase, {
    source_note_id: sourceNoteId,
    target_note_id: targetNoteId,
    relationship_type: relationshipType,
    relationship_note: relationshipNote ?? null,
  });

  if (changeSetId) {
    const { recordChangeSetItem } = await import("./change_set_service");
    await recordChangeSetItem(supabase, {
      change_set_id: changeSetId,
      workspace_id: workspaceId,
      operation: "link_create",
      object_type: "note_link",
      object_id: link.id,
      after_snapshot: {
        source_note_id: sourceNoteId,
        target_note_id: targetNoteId,
        relationship_type: relationshipType,
        relationship_note: relationshipNote ?? null,
      },
    });
  }

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
 * Update a link's relationship_type and/or relationship_note.
 * Implemented as delete + re-insert (no UPDATE policy on note_links).
 * Fields not provided are preserved from the existing link.
 */
export async function updateLink(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  linkId: string,
  {
    newRelationshipType,
    newRelationshipNote,
  }: {
    newRelationshipType?: RelationshipType;
    newRelationshipNote?: string | null;
  }
): Promise<NoteLink> {
  const existing = await getNoteLinkById(supabase, linkId);
  if (!existing) throw new Error("Link not found");

  const resolvedType = newRelationshipType ?? existing.relationship_type;
  // undefined means "don't change"; null means "clear it"
  const resolvedNote =
    newRelationshipNote !== undefined
      ? newRelationshipNote
      : existing.relationship_note;

  // Delete old link
  await deleteNoteLink(supabase, linkId);

  // Re-insert with updated fields
  const replacement = await createNoteLink(supabase, {
    source_note_id: existing.source_note_id,
    target_note_id: existing.target_note_id,
    relationship_type: resolvedType,
    relationship_note: resolvedNote,
  });

  await auditNoteLinkCreated(
    supabase,
    workspaceId,
    userId,
    replacement.id,
    existing.source_note_id,
    existing.target_note_id,
    resolvedType
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
  linkId: string,
  { changeSetId }: { changeSetId?: string | null } = {}
): Promise<void> {
  const link = await getNoteLinkById(supabase, linkId);
  if (!link) throw new Error("Link not found");

  const deleted = await deleteNoteLink(supabase, linkId);
  if (!deleted) throw new Error("Failed to delete link");

  if (changeSetId) {
    const { recordChangeSetItem } = await import("./change_set_service");
    // before_snapshot carries the full link shape so the inverse can
    // recreate it deterministically even after the row is gone.
    await recordChangeSetItem(supabase, {
      change_set_id: changeSetId,
      workspace_id: workspaceId,
      operation: "link_delete",
      object_type: "note_link",
      object_id: linkId,
      before_snapshot: {
        source_note_id: link.source_note_id,
        target_note_id: link.target_note_id,
        relationship_type: link.relationship_type,
        relationship_note: link.relationship_note ?? null,
      },
    });
  }

  await auditNoteLinkDeleted(
    supabase,
    workspaceId,
    userId,
    linkId,
    link.source_note_id,
    link.target_note_id
  );
}
