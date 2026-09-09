import {
  type AgentTool,
  type CheckpointKind,
  type EventActor,
  type SessionEndReason,
  type SessionEventType,
  type SessionStatus,
} from "../constants/agent_session_constants";

/**
 * Domain type: Project
 *
 * The unit agents relay context around — almost always a repository. Sessions
 * and events are project-scoped so a brief can be assembled without scanning
 * the whole workspace.
 */
export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  repo_url: string | null;
  default_branch: string | null;
  status: "active" | "archived";
  session_count: number;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Domain type: AgentSession
 *
 * One run of one agent against one project.
 *
 * `account_label` and `end_reason` carry the relay's whole premise: which plan
 * burned the tokens, and whether the session finished or simply ran out.
 */
export interface AgentSession {
  id: string;
  workspace_id: string;
  project_id: string;
  external_id: string;

  agent_tool: AgentTool;
  agent_model: string | null;
  account_label: string | null;
  agent_version: string | null;

  host: string | null;
  cwd: string | null;
  git_branch: string | null;
  git_commit: string | null;

  title: string | null;
  goal: string | null;

  status: SessionStatus;
  end_reason: SessionEndReason | null;
  resumed_from_session_id: string | null;

  /**
   * Delta cursor for multi-agent check-ins. Held server-side so an agent can
   * call check_in() with no arguments and still get exactly what it has not
   * seen — an agent asked to manage its own cursor will eventually get it
   * wrong, and then either misses events or re-reads them forever.
   */
  last_checkin_at: string | null;
  /**
   * One line: what this agent is doing right now, shown to every peer.
   * Distinct from `goal` — intent changes several times inside one goal.
   */
  current_intent: string | null;
  checkin_count: number;

  event_count: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;

  metadata: Record<string, unknown> | null;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Domain type: SessionEvent
 *
 * One entry in the append-only log. `summary` is the line a brief carries;
 * `payload` is the full detail a reader can drill into.
 */
export interface SessionEvent {
  id: string;
  workspace_id: string;
  project_id: string;
  session_id: string;
  sequence: number;

  event_type: SessionEventType;
  summary: string;
  payload: Record<string, unknown> | null;

  actor: EventActor;
  tool_name: string | null;
  files: string[];
  importance: number;

  tokens_in: number;
  tokens_out: number;
  cost_usd: number;

  client_event_id: string | null;
  redacted_at: string | null;
  occurred_at: string;
  created_at: string;
}

/**
 * The structured half of a checkpoint or brief.
 *
 * Every field is optional because a checkpoint written two minutes into a
 * session legitimately knows the goal and nothing else. Readers must treat a
 * missing field as "unknown", never as "empty".
 */
export interface SessionState {
  goal?: string;
  done?: string[];
  in_flight?: string[];
  blocked?: string[];
  decisions?: string[];
  next_steps?: string[];
  files_touched?: string[];
  open_questions?: string[];
}

/**
 * Domain type: SessionCheckpoint
 *
 * Distilled state over a sequence range. Checkpoints are what make briefs
 * cheap: the assembler prefers one checkpoint over the 200 events behind it.
 */
export interface SessionCheckpoint {
  id: string;
  workspace_id: string;
  project_id: string;
  session_id: string;
  kind: CheckpointKind;
  seq_from: number;
  seq_to: number;
  summary: string;
  state: SessionState;
  token_estimate: number;
  created_at: string;
}

/**
 * Domain type: HandoffBrief
 *
 * The materialised context handed to a resuming agent. Persisted so you can
 * see exactly what the next agent was told, and so a reconnecting client can
 * be re-served without re-reading the log.
 */
export interface HandoffBrief {
  id: string;
  workspace_id: string;
  project_id: string;
  requested_by_session_id: string | null;
  source_session_ids: string[];
  budget_tokens: number;
  token_estimate: number;
  body: string;
  state: SessionState;
  created_at: string;
}

/**
 * A session summarised for the relay chain view: enough to explain who was
 * working, on what, and why they stopped, without loading their events.
 */
export interface SessionSummary {
  id: string;
  external_id: string;
  agent_tool: AgentTool;
  agent_model: string | null;
  account_label: string | null;
  status: SessionStatus;
  end_reason: SessionEndReason | null;
  title: string | null;
  goal: string | null;
  git_branch: string | null;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  event_count: number;
}
