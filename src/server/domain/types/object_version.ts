/**
 * ObjectVersion — immutable version snapshot for files, skills, and agents.
 *
 * Analogous to NoteVersion for notes. Immutable once written — no UPDATE
 * or DELETE policies exist in the database.
 *
 * object_type + object_id forms the polymorphic pointer to the owning row.
 * version_number is 1-indexed and monotonically increasing per object.
 *
 * Notes use note_versions (separate table). Files, skills, and agents use
 * this shared object_versions table.
 */
import { type ActorType, type ChangeOrigin } from "../constants/audit_constants";

export interface ObjectVersion {
  id: string;
  object_type: 'file' | 'skill' | 'agent';
  object_id: string;
  parent_version_id: string | null;
  version_number: number;
  source_content: string;
  content_bytes: number;
  actor_type: ActorType;
  actor_id: string;
  change_origin: ChangeOrigin;
  diff_summary: Record<string, unknown> | null;
  created_at: string;
}
