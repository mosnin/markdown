import { type SupabaseClient } from "@supabase/supabase-js";
import {
  type AgentSession,
  type SessionSummary,
} from "@/server/domain/types/agent_session";
import {
  type AgentTool,
  type SessionEndReason,
  type SessionStatus,
} from "@/server/domain/constants/agent_session_constants";
import { RepositoryError } from "@/server/domain/errors";

/**
 * Agent session repository.
 *
 * Sessions are opened by hooks, not by humans, so every write path here is
 * idempotent on (project_id, external_id): a SessionStart hook that fires
 * twice — which happens on resume, on reconnect, and whenever a wrapper
 * re-execs the agent — must land on one session, not two.
 */

export interface OpenSessionInput {
  workspace_id: string;
  project_id: string;
  external_id: string;
  agent_tool?: AgentTool;
  agent_model?: string | null;
  account_label?: string | null;
  agent_version?: string | null;
  host?: string | null;
  cwd?: string | null;
  git_branch?: string | null;
  git_commit?: string | null;
  title?: string | null;
  goal?: string | null;
  resumed_from_session_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateSessionInput {
  title?: string | null;
  goal?: string | null;
  git_branch?: string | null;
  git_commit?: string | null;
  agent_model?: string | null;
  account_label?: string | null;
  status?: SessionStatus;
  end_reason?: SessionEndReason | null;
  ended_at?: string | null;
  last_seen_at?: string;
  resumed_from_session_id?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Multi-agent check-in bookkeeping. Written only by the check-in path. */
  last_checkin_at?: string | null;
  current_intent?: string | null;
  checkin_count?: number;
}

const SUMMARY_COLUMNS =
  "id, external_id, agent_tool, agent_model, account_label, status, end_reason, " +
  "title, goal, git_branch, started_at, last_seen_at, ended_at, event_count";

export async function getSessionById(
  client: SupabaseClient,
  sessionId: string
): Promise<AgentSession | null> {
  const { data, error } = await client
    .from("agent_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new RepositoryError(`Failed to load session: ${error.message}`);
  }
  return (data as AgentSession) ?? null;
}

export async function getSessionByExternalId(
  client: SupabaseClient,
  projectId: string,
  externalId: string
): Promise<AgentSession | null> {
  const { data, error } = await client
    .from("agent_sessions")
    .select("*")
    .eq("project_id", projectId)
    .eq("external_id", externalId)
    .maybeSingle();

  if (error) {
    throw new RepositoryError(
      `Failed to load session by external id: ${error.message}`
    );
  }
  return (data as AgentSession) ?? null;
}

export async function listSessionsForProject(
  client: SupabaseClient,
  projectId: string,
  options: { limit?: number; status?: SessionStatus } = {}
): Promise<SessionSummary[]> {
  let query = client
    .from("agent_sessions")
    .select(SUMMARY_COLUMNS)
    .eq("project_id", projectId)
    .order("started_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (options.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error) {
    throw new RepositoryError(`Failed to list sessions: ${error.message}`);
  }
  return (data ?? []) as unknown as SessionSummary[];
}

/**
 * Sessions worth folding into a handoff brief, newest first.
 *
 * Excludes the requesting session itself so an agent asking "what happened
 * before me" is never handed its own events back as history.
 */
export async function listRecentSessionsForBrief(
  client: SupabaseClient,
  projectId: string,
  options: { excludeSessionId?: string; limit?: number } = {}
): Promise<AgentSession[]> {
  let query = client
    .from("agent_sessions")
    .select("*")
    .eq("project_id", projectId)
    .order("last_seen_at", { ascending: false })
    .limit(options.limit ?? 10);

  if (options.excludeSessionId) {
    query = query.neq("id", options.excludeSessionId);
  }

  const { data, error } = await query;
  if (error) {
    throw new RepositoryError(
      `Failed to list sessions for brief: ${error.message}`
    );
  }
  return (data ?? []) as AgentSession[];
}

export async function updateSession(
  client: SupabaseClient,
  sessionId: string,
  input: UpdateSessionInput
): Promise<AgentSession> {
  const { data, error } = await client
    .from("agent_sessions")
    .update(input)
    .eq("id", sessionId)
    .select("*")
    .single();

  if (error) {
    throw new RepositoryError(`Failed to update session: ${error.message}`);
  }
  return data as AgentSession;
}

/**
 * Open a session, or return the existing one for this external id.
 *
 * On re-open we refresh the fields that legitimately change across a resume
 * (branch, commit, model, title, goal) but never rewind `started_at` and
 * never resurrect an ended session's timestamps — a re-opened session that
 * had ended returns to 'active' with its original start intact, so the
 * timeline stays honest about how long the work has been running.
 */
export async function openSession(
  client: SupabaseClient,
  input: OpenSessionInput
): Promise<{ session: AgentSession; created: boolean }> {
  const existing = await getSessionByExternalId(
    client,
    input.project_id,
    input.external_id
  );

  if (existing) {
    const refresh: UpdateSessionInput = {
      last_seen_at: new Date().toISOString(),
    };
    if (input.title != null) refresh.title = input.title;
    if (input.goal != null) refresh.goal = input.goal;
    if (input.git_branch != null) refresh.git_branch = input.git_branch;
    if (input.git_commit != null) refresh.git_commit = input.git_commit;
    if (input.agent_model != null) refresh.agent_model = input.agent_model;
    if (input.account_label != null) refresh.account_label = input.account_label;
    if (input.resumed_from_session_id != null) {
      refresh.resumed_from_session_id = input.resumed_from_session_id;
    }
    if (existing.status === "ended") {
      refresh.status = "active";
      refresh.ended_at = null;
      refresh.end_reason = null;
    }

    const session = await updateSession(client, existing.id, refresh);
    return { session, created: false };
  }

  const { data, error } = await client
    .from("agent_sessions")
    .insert({ ...input, agent_tool: input.agent_tool ?? "custom" })
    .select("*")
    .single();

  if (error) {
    // Lost the race against a concurrent SessionStart for the same id.
    if (error.code === "23505") {
      const raced = await getSessionByExternalId(
        client,
        input.project_id,
        input.external_id
      );
      if (raced) return { session: raced, created: false };
    }
    throw new RepositoryError(`Failed to open session: ${error.message}`);
  }

  return { session: data as AgentSession, created: true };
}

/**
 * Close a session.
 *
 * Idempotent: closing an already-ended session leaves the original end
 * timestamp and reason alone. The first answer about why a session stopped is
 * the truthful one — a later `SessionEnd` hook firing during shutdown must not
 * overwrite `usage_capped` with `completed`.
 */
export async function closeSession(
  client: SupabaseClient,
  sessionId: string,
  endReason: SessionEndReason
): Promise<AgentSession> {
  const existing = await getSessionById(client, sessionId);
  if (!existing) {
    throw new RepositoryError(`Session ${sessionId} not found`);
  }
  if (existing.status === "ended") return existing;

  return updateSession(client, sessionId, {
    status: "ended",
    end_reason: endReason,
    ended_at: new Date().toISOString(),
  });
}

/**
 * Mark sessions idle once they have gone quiet.
 *
 * Called opportunistically by reads rather than on a timer: a session that
 * stopped emitting is not an event we can be told about — a hard-capped agent
 * is killed mid-call and never gets to say goodbye. Silence is the signal.
 */
export async function markStaleSessionsIdle(
  client: SupabaseClient,
  projectId: string,
  idleAfterMs: number
): Promise<number> {
  const cutoff = new Date(Date.now() - idleAfterMs).toISOString();

  const { data, error } = await client
    .from("agent_sessions")
    .update({ status: "idle" })
    .eq("project_id", projectId)
    .eq("status", "active")
    .lt("last_seen_at", cutoff)
    .select("id");

  if (error) {
    throw new RepositoryError(
      `Failed to mark stale sessions idle: ${error.message}`
    );
  }
  return (data ?? []).length;
}
