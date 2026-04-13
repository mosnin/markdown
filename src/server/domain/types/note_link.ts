import { type RelationshipType } from "../constants/note_constants";

/**
 * Domain type: NoteLink
 *
 * Explicit directed relationship between two notes.
 * Same-box constraint is enforced at the service layer, not the database.
 * Self-links are rejected by a database CHECK constraint.
 *
 * relationship_note: optional free-form annotation describing the specific
 * nature of the connection. First-class field — included in search and
 * exported in manifests.
 */
export interface NoteLink {
  id: string;
  source_note_id: string;
  target_note_id: string;
  relationship_type: RelationshipType;
  /** Optional annotation describing the specific nature of this link. */
  relationship_note: string | null;
  /**
   * Non-null when the link exists only on a draft branch. Cleared on
   * promote; hard-deleted on discard. Main readers filter to
   * `branch_id IS NULL`; branch readers keep main + matching-branch
   * rows. Mirrors `object_links.branch_id`. See
   * docs/branch_local_structural_creation_v1.md (v1.10).
   */
  branch_id: string | null;
  created_at: string;
}
