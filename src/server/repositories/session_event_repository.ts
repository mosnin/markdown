import { type SupabaseClient } from "@supabase/supabase-js";
import {
  type HandoffBrief,
  type SessionCheckpoint,
  type SessionEvent,
  type SessionState,
} from "@/server/domain/types/agent_session";
import { type CheckpointKind } from "@/server/domain/constants/agent_session_constants";
import { RepositoryError } from "@/server/domain/errors";

/**
 * Session event, checkpoint, and brief repository.
 *
 * The event log is append-only. There is deliberately no update or delete
 * helper here: the only mutation the product allows is redaction, which is a
 * separate, audited path. If you find yourself wanting `updateEvent`, what you
 * want is another event.
 */

// ─── Events ─────────────────────────────────────────────────────────────────

/** One event as submitted by a client, before sequencing. */
export interface EventInput {
  event_type: string;
  summary: string;
  payload?: Record<string, unknown> | null;
  actor?: string;
  tool_name?: string | null;
  files?: string[];
  importance?: number;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  client_event_id?: string | null;
  occurred_at?: string;
}

/**
 * Append a batch atomically via the append_session_events() RPC.
 *
 * Returns only the rows actually inserted — a fully replayed batch returns an
 * empty array, which is how callers know not to re-fire webhooks for it.
 *
 * Requires a service-role client: the function is SECURITY DEFINER and its
 * EXECUTE grant is limited to service_role, because the authorization decision
 * (does this token own this session?) happens above it, in the ingest service.
 */
export async function appendEvents(
  client: SupabaseClient,
  sessionId: string,
  events: EventInput[]
): Promise<SessionEvent[]> {
  const { data, error } = await client.rpc("append_session_events", {
    p_session_id: sessionId,
    p_events: events,
  });

  if (error) {
    throw new RepositoryError(`Failed to append events: ${error.message}`);
  }
  return (data ?? []) as SessionEvent[];
}

export async function listEventsForSession(
  client: SupabaseClient,
  sessionId: string,
  options: { afterSequence?: number; limit?: number; ascending?: boolean } = {}
): Promise<SessionEvent[]> {
  let query = client
    .from("session_events")
    .select("*")
    .eq("session_id", sessionId)
    .order("sequence", { ascending: options.ascending ?? true })
    .limit(options.limit ?? 200);

  if (options.afterSequence !== undefined) {
    query = query.gt("sequence", options.afterSequence);
  }

  const { data, error } = await query;
  if (error) {
    throw new RepositoryError(`Failed to list session events: ${error.message}`);
  }
  return (data ?? []) as SessionEvent[];
}

/**
 * The project's live timeline: newest events across every session.
 *
 * This is what the dashboard streams and what a human watches while three
 * agents work at once.
 */
export async function listRecentEventsForProject(
  client: SupabaseClient,
  projectId: string,
  options: { limit?: number; minImportance?: number; since?: string } = {}
): Promise<SessionEvent[]> {
  let query = client
    .from("session_events")
    .select("*")
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (options.minImportance !== undefined) {
    query = query.gte("importance", options.minImportance);
  }
  if (options.since) {
    query = query.gt("occurred_at", options.since);
  }

  const { data, error } = await query;
  if (error) {
    throw new RepositoryError(`Failed to list project events: ${error.message}`);
  }
  return (data ?? []) as SessionEvent[];
}

/**
 * The salient events of a session, newest first.
 *
 * Ordered by importance before recency: the decision made an hour ago matters
 * more to a resuming agent than the file read a minute ago. This is the query
 * the brief assembler leans on when a session has no checkpoint.
 */
export async function listSalientEvents(
  client: SupabaseClient,
  sessionId: string,
  options: { minImportance?: number; limit?: number; afterSequence?: number } = {}
): Promise<SessionEvent[]> {
  let query = client
    .from("session_events")
    .select("*")
    .eq("session_id", sessionId)
    .gte("importance", options.minImportance ?? 3)
    .order("importance", { ascending: false })
    .order("occurred_at", { ascending: false })
    .limit(options.limit ?? 40);

  if (options.afterSequence !== undefined) {
    query = query.gt("sequence", options.afterSequence);
  }

  const { data, error } = await query;
  if (error) {
    throw new RepositoryError(`Failed to list salient events: ${error.message}`);
  }
  return (data ?? []) as SessionEvent[];
}

/** Free-text search across a project's event summaries. */
export async function searchEvents(
  client: SupabaseClient,
  projectId: string,
  term: string,
  options: { limit?: number } = {}
): Promise<SessionEvent[]> {
  // Escape PostgREST's ilike wildcards so a search for "100%" is literal.
  const escaped = term.replace(/[%_]/g, (ch) => `\\${ch}`);

  const { data, error } = await client
    .from("session_events")
    .select("*")
    .eq("project_id", projectId)
    .ilike("summary", `%${escaped}%`)
    .order("occurred_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (error) {
    throw new RepositoryError(`Failed to search events: ${error.message}`);
  }
  return (data ?? []) as SessionEvent[];
}

// ─── Checkpoints ────────────────────────────────────────────────────────────

export interface CreateCheckpointInput {
  workspace_id: string;
  project_id: string;
  session_id: string;
  kind: CheckpointKind;
  seq_from: number;
  seq_to: number;
  summary: string;
  state: SessionState;
  token_estimate: number;
}

export async function createCheckpoint(
  client: SupabaseClient,
  input: CreateCheckpointInput
): Promise<SessionCheckpoint> {
  const { data, error } = await client
    .from("session_checkpoints")
    .insert(input)
    .select("*")
    .single();

  if (error) {
    throw new RepositoryError(`Failed to create checkpoint: ${error.message}`);
  }
  return data as SessionCheckpoint;
}

/** The most recent checkpoint for a session, or null if it has none. */
export async function getLatestCheckpoint(
  client: SupabaseClient,
  sessionId: string
): Promise<SessionCheckpoint | null> {
  const { data, error } = await client
    .from("session_checkpoints")
    .select("*")
    .eq("session_id", sessionId)
    .order("seq_to", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new RepositoryError(`Failed to load checkpoint: ${error.message}`);
  }
  return (data as SessionCheckpoint) ?? null;
}

/** Latest checkpoint for each of the given sessions, keyed by session id. */
export async function getLatestCheckpoints(
  client: SupabaseClient,
  sessionIds: string[]
): Promise<Map<string, SessionCheckpoint>> {
  if (sessionIds.length === 0) return new Map();

  const { data, error } = await client
    .from("session_checkpoints")
    .select("*")
    .in("session_id", sessionIds)
    .order("seq_to", { ascending: false });

  if (error) {
    throw new RepositoryError(`Failed to load checkpoints: ${error.message}`);
  }

  const latest = new Map<string, SessionCheckpoint>();
  for (const row of (data ?? []) as SessionCheckpoint[]) {
    // Rows arrive newest-first, so the first one we see per session wins.
    if (!latest.has(row.session_id)) latest.set(row.session_id, row);
  }
  return latest;
}

// ─── Handoff briefs ─────────────────────────────────────────────────────────

export interface CreateBriefInput {
  workspace_id: string;
  project_id: string;
  requested_by_session_id?: string | null;
  source_session_ids: string[];
  budget_tokens: number;
  token_estimate: number;
  body: string;
  state: SessionState;
}

export async function createHandoffBrief(
  client: SupabaseClient,
  input: CreateBriefInput
): Promise<HandoffBrief> {
  const { data, error } = await client
    .from("handoff_briefs")
    .insert(input)
    .select("*")
    .single();

  if (error) {
    throw new RepositoryError(`Failed to create handoff brief: ${error.message}`);
  }
  return data as HandoffBrief;
}

export async function listHandoffBriefs(
  client: SupabaseClient,
  projectId: string,
  options: { limit?: number } = {}
): Promise<HandoffBrief[]> {
  const { data, error } = await client
    .from("handoff_briefs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 20);

  if (error) {
    throw new RepositoryError(`Failed to list handoff briefs: ${error.message}`);
  }
  return (data ?? []) as HandoffBrief[];
}
