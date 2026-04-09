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
  created_at: string;
}
