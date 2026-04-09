import { type ProposalType, type ProposalStatus } from "../constants/audit_constants";

/**
 * Domain type: WriteProposal
 *
 * A connection's request to create or modify a note, pending human review.
 *
 * target_version_id: the note's version at proposal submission time.
 *   If the note has advanced since, status should be 'conflicted'.
 *   Services should check this before presenting a proposal for review.
 *
 * approved_note_id / approved_version_id: populated when a 'create_note'
 *   proposal is approved and a new note is written.
 *
 * proposed_folder_id: for 'create_note' proposals — target folder.
 */
export interface WriteProposal {
  id: string;
  workspace_id: string;
  connection_id: string;
  target_note_id: string | null;
  target_version_id: string | null;
  proposal_type: ProposalType;
  status: ProposalStatus;
  proposed_title: string | null;
  proposed_content: string | null;
  proposed_folder_id: string | null;
  rationale: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  approved_note_id: string | null;
  approved_version_id: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}
