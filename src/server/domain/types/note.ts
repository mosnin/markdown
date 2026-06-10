import { type NoteStatus } from "../constants/content_status";
import { type NoteKind, type NoteOriginType } from "../constants/note_constants";

/**
 * Domain type: Note
 *
 * Matches the public.notes table shape.
 *
 * kind: the note's template type ('note' | 'guide' | 'bundle').
 *   This does NOT determine whether the note is a box's guide.
 *   Guide assignment lives exclusively in boxes.guide_note_id.
 *
 * current_version_id: null until the first version is created.
 *
 * path_cache: derived (e.g. '/research/papers/my-note'). Maintained by
 *   the service layer. Not identity — slug chain is authoritative.
 *
 * retrieval_priority: 0–10 hint for AI context retrieval ordering.
 *
 * content_bytes: kept in sync with len(markdown_content) for cheap storage
 *   accounting. Do not rely on it as the ground truth — recompute from
 *   markdown_content when precision matters.
 */
export interface Note {
  id: string;
  box_id: string;
  folder_id: string | null;
  current_version_id: string | null;
  title: string;
  slug: string;
  path_cache: string;
  markdown_content: string;
  content_bytes: number;
  summary: string | null;
  tags: string[];
  read_hint: string | null;
  retrieval_priority: number;
  kind: NoteKind;
  status: NoteStatus;
  origin_type: NoteOriginType;
  is_generated: boolean;
  generated_by_connection_id: string | null;
  /**
   * Non-null when the note exists only on a draft branch (created
   * while the user was on a branch via `createNoteOnBranch`).
   * Cleared on promote; hard-deleted on discard. See
   * docs/branch_local_structural_creation_v1.md.
   */
  branch_id: string | null;
  /**
   * Monotonic counter mixed into the note's share token. Bumping it
   * (via an explicit revoke) invalidates every previously issued share
   * link. Defaults to 1. See src/lib/share_token.ts.
   */
  share_version: number;
  created_at: string;
  updated_at: string;
}
