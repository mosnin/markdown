import { type ActorType, type ChangeOrigin } from "../constants/audit_constants";

/**
 * Domain type: NoteVersion
 *
 * Matches the public.note_versions table shape. Immutable once written.
 *
 * version_number: monotonically increasing within a note, starting at 1.
 * parent_version_id: forms a linked list of version history.
 *
 * actor_type / actor_id:
 *   'user'       → actor_id is a uuid (auth.users.id)
 *   'connection' → actor_id is a uuid (connections.id)
 *   'system'     → actor_id = 'system'
 *
 * diff_summary: lightweight jsonb describing what changed (field names, char deltas).
 * diff_patch:   optional full unified diff for audit and revert support.
 */
export interface NoteVersion {
  id: string;
  note_id: string;
  parent_version_id: string | null;
  version_number: number;
  title: string;
  markdown_content: string;
  content_bytes: number;
  actor_type: ActorType;
  actor_id: string;
  change_origin: ChangeOrigin;
  diff_summary: Record<string, unknown> | null;
  diff_patch: string | null;
  created_at: string;
}
