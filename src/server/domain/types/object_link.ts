/**
 * ObjectLink — heterogeneous semantic relationship.
 *
 * Generalizes the existing NoteLink concept to all object types. An ObjectLink
 * can connect any combination of note, file, skill, agent, or folder nodes.
 *
 * ObjectLinks are directed: source → target. They are NOT backlinks.
 * The same 10-value relationship vocabulary applies as for note_links.
 *
 * Notes may continue to use note_links for note-to-note relationships.
 * ObjectLinks are used when at least one endpoint is a non-note object type,
 * or when mixed-type relationships are needed.
 *
 * Workspace scoping is enforced by workspace_id. Same-workspace constraint
 * must be enforced at the service layer (not DB-level due to polymorphism).
 */
import { type RelationshipType } from "../constants/note_constants";
import { type ObjectType } from "../constants/object_constants";

export interface ObjectLink {
  id: string;
  workspace_id: string;
  source_object_type: ObjectType;
  source_object_id: string;
  target_object_type: ObjectType;
  target_object_id: string;
  relationship_type: RelationshipType;
  relationship_note: string | null;
  created_at: string;
}
