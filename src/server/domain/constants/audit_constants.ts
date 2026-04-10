/**
 * Actor types, change origins, and proposal vocabularies.
 */

export const ACTOR_TYPE = {
  USER: "user",
  CONNECTION: "connection",
  SYSTEM: "system",
} as const;

export type ActorType = (typeof ACTOR_TYPE)[keyof typeof ACTOR_TYPE];

/**
 * How a note version came to exist.
 */
export const CHANGE_ORIGIN = {
  HUMAN_EDIT: "human_edit",
  IMPORT: "import",
  GENERATED: "generated",
  PROPOSAL_APPROVED: "proposal_approved",
  ROLLBACK: "rollback",
  PROMOTION: "promotion",
} as const;

export type ChangeOrigin = (typeof CHANGE_ORIGIN)[keyof typeof CHANGE_ORIGIN];

/**
 * What a write proposal intends to do.
 */
export const PROPOSAL_TYPE = {
  CREATE_NOTE: "create_note",
  UPDATE_NOTE: "update_note",
  APPEND_NOTE: "append_note",
  REPLACE_NOTE: "replace_note",
} as const;

export type ProposalType =
  (typeof PROPOSAL_TYPE)[keyof typeof PROPOSAL_TYPE];

/**
 * Current lifecycle state of a write proposal.
 *
 * 'conflicted' — the target note was updated after the proposal was submitted
 *               (target_version_id no longer matches current_version_id).
 */
export const PROPOSAL_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  CONFLICTED: "conflicted",
  CANCELED: "canceled",
  EXPIRED: "expired",
} as const;

export type ProposalStatus =
  (typeof PROPOSAL_STATUS)[keyof typeof PROPOSAL_STATUS];
