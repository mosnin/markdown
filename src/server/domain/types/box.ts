import { type BoxStatus } from "../constants/content_status";

/**
 * Domain type: Box
 *
 * Matches the public.boxes table shape.
 *
 * guide_note_id is the ONLY canonical pointer to a box's guide note.
 * Do not infer guide status from notes.kind — that field describes the
 * note's template type, not its assignment as a box guide.
 *
 * Application code must guard against trashing a note that is currently
 * a box's guide_note_id without first clearing the pointer.
 * The database uses ON DELETE SET NULL for this FK, so the pointer will
 * be cleared if the note is hard-deleted (which should not happen in V1).
 */
export interface Box {
  id: string;
  workspace_id: string;
  guide_note_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: BoxStatus;
  created_at: string;
  updated_at: string;
}
