import { type RelationshipType } from "../constants/note_constants";

/**
 * Domain type: NoteLink
 *
 * Explicit directed relationship between two notes.
 * Same-box constraint is enforced at the service layer, not the database.
 * Self-links are rejected by a database CHECK constraint.
 */
export interface NoteLink {
  id: string;
  source_note_id: string;
  target_note_id: string;
  relationship_type: RelationshipType;
  created_at: string;
}
