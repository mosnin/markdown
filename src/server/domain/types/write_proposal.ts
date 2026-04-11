import { type ProposalType, type ProposalStatus } from "../constants/audit_constants";

/**
 * Domain type: WriteProposal
 *
 * A connection's request to create or modify a note, file, skill, or agent,
 * pending human review.
 *
 * Note targets (original fields):
 *   target_note_id    — note being proposed against (update/append/replace)
 *   target_version_id — note's current_version_id at submission time
 *                       Used for conflict detection on approval.
 *   proposed_folder_id — for create_note proposals: the target folder
 *
 * Object targets (extended fields):
 *   target_object_type — 'file' | 'skill' | 'agent' (null for note proposals)
 *   target_object_id   — id in files/skills/agents table
 *   target_object_version_id — object_versions.id captured at submission
 *                              Used for conflict detection (mirrors target_version_id)
 *
 * A proposal targets exactly one thing — either a note (target_note_id set)
 * or an object (target_object_type + target_object_id set). Never both.
 *
 * approved_note_id / approved_version_id: populated when a 'create_note'
 *   proposal is approved and a new note is written.
 *   For object update proposals, approved_version_id is set to the new
 *   object_versions.id created by approval.
 */
export interface WriteProposal {
  id: string;
  workspace_id: string;
  connection_id: string;

  // ── Note target ────────────────────────────────────────────────────────────
  target_note_id: string | null;
  target_version_id: string | null;
  proposed_folder_id: string | null;

  // ── Object target (file / skill / agent) ───────────────────────────────────
  target_object_type: "file" | "skill" | "agent" | null;
  target_object_id: string | null;
  target_object_version_id: string | null;

  // ── Proposal content ───────────────────────────────────────────────────────
  proposal_type: ProposalType;
  status: ProposalStatus;
  proposed_title: string | null;
  proposed_content: string | null;
  proposed_summary: string | null;
  proposed_tags: string[] | null;
  rationale: string | null;

  // ── Review ─────────────────────────────────────────────────────────────────
  reviewer_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  approved_note_id: string | null;
  approved_version_id: string | null;
  expires_at: string | null;

  created_at: string;
  updated_at: string;
}
