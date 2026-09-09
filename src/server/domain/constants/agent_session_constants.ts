/**
 * Constants for the agent context relay.
 *
 * These mirror the CHECK constraints in
 * supabase/migrations/20260909000001_agent_context_relay.sql. When you change
 * one, change both — the database is the enforcement point and these arrays
 * are what the API validates against before it gets there.
 */

// ─── Agent tools ────────────────────────────────────────────────────────────

export const AGENT_TOOLS = [
  "claude_code",
  "codex",
  "cursor",
  "copilot",
  "aider",
  "ci",
  "custom",
] as const;

export type AgentTool = (typeof AGENT_TOOLS)[number];

// ─── Session status ─────────────────────────────────────────────────────────

export const SESSION_STATUS = {
  ACTIVE: "active",
  IDLE: "idle",
  ENDED: "ended",
} as const;

export const SESSION_STATUSES = [
  SESSION_STATUS.ACTIVE,
  SESSION_STATUS.IDLE,
  SESSION_STATUS.ENDED,
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * How a session stopped.
 *
 * `usage_capped` is the reason this product exists: the agent did not finish,
 * it ran out of plan. It is a normal outcome and the strongest possible hint
 * that someone is about to start a fresh session on the same work.
 */
export const SESSION_END_REASONS = [
  "completed",
  "usage_capped",
  "context_exhausted",
  "crashed",
  "user_stopped",
  "unknown",
] as const;

export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

/** End reasons that mean "work was left unfinished". */
export const UNFINISHED_END_REASONS: readonly SessionEndReason[] = [
  "usage_capped",
  "context_exhausted",
  "crashed",
];

// ─── Events ─────────────────────────────────────────────────────────────────

export const SESSION_EVENT_TYPES = [
  "session_start",
  "session_end",
  "prompt",
  "assistant_message",
  "tool_call",
  "tool_result",
  "tool_error",
  "file_read",
  "file_edit",
  "file_create",
  "file_delete",
  "command",
  "command_result",
  "test_run",
  "build",
  "lint",
  "commit",
  "branch_change",
  "push",
  "decision",
  "blocker",
  "question",
  "note",
  "checkpoint",
  "compaction",
  "usage_update",
  "usage_limit",
  "handoff_requested",
  "handoff_consumed",
  "error",
  "custom",
] as const;

export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

export const EVENT_ACTORS = ["agent", "user", "system", "hook"] as const;
export type EventActor = (typeof EVENT_ACTORS)[number];

/**
 * Default salience per event type, used when a client does not set one.
 *
 * The scale is 0 (noise) to 5 (must appear in every brief). The values here
 * encode the product's core opinion about what survives a handoff: what you
 * decided and what is blocking you always survives; what file you read does
 * not.
 */
export const DEFAULT_EVENT_IMPORTANCE: Record<SessionEventType, number> = {
  session_start: 3,
  session_end: 4,
  prompt: 4,
  assistant_message: 1,
  tool_call: 1,
  tool_result: 1,
  tool_error: 3,
  file_read: 0,
  file_edit: 2,
  file_create: 3,
  file_delete: 3,
  command: 1,
  command_result: 1,
  test_run: 3,
  build: 2,
  lint: 1,
  commit: 4,
  branch_change: 3,
  push: 3,
  decision: 5,
  blocker: 5,
  question: 4,
  note: 3,
  checkpoint: 5,
  compaction: 4,
  usage_update: 0,
  usage_limit: 5,
  handoff_requested: 3,
  handoff_consumed: 3,
  error: 3,
  custom: 2,
};

/** Minimum salience an event needs to be considered for a handoff brief. */
export const BRIEF_IMPORTANCE_FLOOR = 2;

// ─── Checkpoints ────────────────────────────────────────────────────────────

export const CHECKPOINT_KINDS = [
  "auto",
  "manual",
  "compaction",
  "session_end",
] as const;

export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

// ─── Briefs ─────────────────────────────────────────────────────────────────

/** Default token budget for an assembled handoff brief. */
export const DEFAULT_BRIEF_BUDGET_TOKENS = 4000;
/** Hard ceiling, so a client cannot ask us to serialise an entire project. */
export const MAX_BRIEF_BUDGET_TOKENS = 32000;
/** Floor, below which a brief cannot carry enough to be worth serving. */
export const MIN_BRIEF_BUDGET_TOKENS = 500;

// ─── Ingest limits ──────────────────────────────────────────────────────────

/** Max events accepted in one POST /api/v1/events batch. */
export const MAX_EVENTS_PER_BATCH = 200;
/** Max serialised size of a single event payload, in bytes. */
export const MAX_EVENT_PAYLOAD_BYTES = 64 * 1024;

/**
 * How long a session may go without any event before a reader should treat it
 * as idle rather than live. Deliberately generous: an agent can legitimately
 * spend minutes inside one tool call.
 */
export const SESSION_IDLE_AFTER_MS = 5 * 60 * 1000;
