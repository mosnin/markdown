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
 *
 * Note proposals (existing):
 *   create_note   — propose creating a new note in a folder
 *   update_note   — propose full content replacement on an existing note
 *   append_note   — propose appending markdown to an existing note
 *   replace_note  — destructive full replacement (visually flagged in review UI)
 *
 * Object proposals (extended):
 *   update_file   — propose replacing a file's source_content
 *   create_skill  — propose creating a new reusable skill (workspace-level)
 *   update_skill  — propose replacing a skill's source_content
 *   create_agent  — propose creating a new reusable agent (workspace-level)
 *   update_agent  — propose replacing an agent's source_content
 *
 * Append semantics do not apply to files/skills/agents — only replace/update.
 * Box-local files/skills/agents follow the same proposal model as notes.
 * Workspace-reusable skills/agents are proposal-only for external writes.
 */
export const PROPOSAL_TYPE = {
  CREATE_NOTE: "create_note",
  UPDATE_NOTE: "update_note",
  APPEND_NOTE: "append_note",
  REPLACE_NOTE: "replace_note",
  UPDATE_FILE: "update_file",
  CREATE_SKILL: "create_skill",
  UPDATE_SKILL: "update_skill",
  CREATE_AGENT: "create_agent",
  UPDATE_AGENT: "update_agent",
} as const;

export type ProposalType =
  (typeof PROPOSAL_TYPE)[keyof typeof PROPOSAL_TYPE];

/** Subset of proposal types that target notes. */
export const NOTE_PROPOSAL_TYPES = new Set<ProposalType>([
  PROPOSAL_TYPE.CREATE_NOTE,
  PROPOSAL_TYPE.UPDATE_NOTE,
  PROPOSAL_TYPE.APPEND_NOTE,
  PROPOSAL_TYPE.REPLACE_NOTE,
]);

/** Subset of proposal types that target files, skills, or agents. */
export const OBJECT_PROPOSAL_TYPES = new Set<ProposalType>([
  PROPOSAL_TYPE.UPDATE_FILE,
  PROPOSAL_TYPE.CREATE_SKILL,
  PROPOSAL_TYPE.UPDATE_SKILL,
  PROPOSAL_TYPE.CREATE_AGENT,
  PROPOSAL_TYPE.UPDATE_AGENT,
]);

/**
 * Current lifecycle state of a write proposal.
 *
 * 'conflicted' — the target object was updated after the proposal was submitted
 *               (target_version_id / target_object_version_id no longer matches
 *               the object's current_version_id).
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

// Note: OBJECT_TYPE, ObjectType, and VERSIONED_OBJECT_TYPES are exported
// from object_constants.ts — import from there for structural object types.
