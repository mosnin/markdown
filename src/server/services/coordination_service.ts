import { type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { RepositoryError, ValidationError } from "@/server/domain/errors";
import { type AgentSession } from "@/server/domain/types/agent_session";
import { SESSION_IDLE_AFTER_MS } from "@/server/domain/constants/agent_session_constants";
import {
  getSessionById,
  updateSession,
  markStaleSessionsIdle,
} from "@/server/repositories/agent_session_repository";
import { listRecentEventsForProject } from "@/server/repositories/session_event_repository";
import { redactString, redactFilePaths } from "@/server/services/session_event_redaction";
import { dispatchEvent } from "@/server/services/content_webhook_service";

/**
 * Multi-agent coordination — the shared workspace layer.
 *
 * The relay layer answers "what happened before me". This answers "who else is
 * here right now, and am I about to collide with them".
 *
 * Everything centres on ONE call: `checkIn`. A coding agent is turn-based — it
 * cannot hold a socket open between tool calls the way a dashboard can — so
 * push is for humans and pull is for agents. Rather than make an agent
 * orchestrate four separate calls (heartbeat, poll, renew, detect), check-in
 * does all four at once and returns everything it needs to act:
 *
 *   - I am alive, and here is what I am doing now.
 *   - Here is what changed since I last asked.
 *   - Keep holding what I claimed.
 *   - Tell me if anyone walked into my territory, or I into theirs.
 *
 * The design bet is that an agent will reliably call one tool periodically, and
 * will not reliably manage a cursor, a lease timer, and a subscription.
 */

// ─── Tuning ─────────────────────────────────────────────────────────────────

/** Default claim lifetime. Renewed by check-in; expires on its own if not. */
export const DEFAULT_CLAIM_TTL_SECONDS = 900;

/**
 * How long to suggest an agent waits before checking in again.
 *
 * Tuned to be shorter than the claim TTL by a wide margin, so an agent that
 * follows the hint renews well before expiry and a single missed check-in never
 * costs it its claims.
 */
export const SUGGESTED_CHECKIN_SECONDS = 240;

/** Max events returned in one check-in delta. Beyond this, salience filters. */
const MAX_DELTA_EVENTS = 40;
/** Max notices returned in one check-in. */
const MAX_DELTA_NOTICES = 20;
/** Salience floor for events in a delta — routine file reads are not news. */
const DELTA_IMPORTANCE_FLOOR = 3;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ClaimRequest {
  resource: string;
  kind?: "file" | "directory" | "subsystem" | "task";
  intent?: string;
}

export interface ClaimOutcome {
  resource: string;
  granted: boolean;
  held_by: string | null;
  held_by_label?: string | null;
  held_intent: string | null;
  expires_at: string;
}

export interface PeerAgent {
  session_id: string;
  agent_tool: string;
  agent_model: string | null;
  account_label: string | null;
  status: string;
  current_intent: string | null;
  git_branch: string | null;
  last_seen_at: string;
  claims: string[];
}

export interface Conflict {
  resource: string;
  /** "someone_edited_my_claim" | "my_claim_request_refused" */
  reason: string;
  other_session_id: string | null;
  other_label: string | null;
  detail: string;
}

export interface CheckInResult {
  session_id: string;
  checked_in_at: string;
  /** Claims this session currently holds, after renewals and releases. */
  holding: Array<{ resource: string; expires_at: string }>;
  claim_outcomes: ClaimOutcome[];
  peers: PeerAgent[];
  events: Array<{
    session_id: string;
    event_type: string;
    summary: string;
    importance: number;
    files: string[];
    occurred_at: string;
  }>;
  notices: Array<{
    id: string;
    from_session_id: string | null;
    kind: string;
    body: string;
    importance: number;
    created_at: string;
  }>;
  conflicts: Conflict[];
  open_questions: Array<{ id: string; body: string; from_session_id: string | null }>;
  next_checkin_after_seconds: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function labelFor(session: {
  agent_tool: string;
  account_label: string | null;
}): string {
  return session.account_label
    ? `${session.agent_tool} (${session.account_label})`
    : session.agent_tool;
}

/**
 * Does an edit to `file` touch `claim`?
 *
 * Exact match, or the claim is a directory prefix of the file. Deliberately no
 * fuzzier than that: a false conflict is worse than a missed one, because an
 * agent that is warned about collisions it does not have learns to ignore
 * collision warnings entirely.
 */
export function resourceOverlaps(claim: string, file: string): boolean {
  if (claim === file) return true;
  const prefix = claim.endsWith("/") ? claim : `${claim}/`;
  return file.startsWith(prefix);
}

// ─── Claims ─────────────────────────────────────────────────────────────────

export async function claimResources(
  client: SupabaseClient,
  sessionId: string,
  resources: ClaimRequest[],
  ttlSeconds = DEFAULT_CLAIM_TTL_SECONDS
): Promise<ClaimOutcome[]> {
  if (resources.length === 0) return [];

  const normalised = resources
    .filter((r) => typeof r?.resource === "string" && r.resource.trim().length > 0)
    .slice(0, 50)
    .map((r) => ({
      resource: redactFilePaths([r.resource.trim()])[0].slice(0, 500),
      kind: r.kind ?? "file",
      intent: r.intent ? redactString(r.intent).slice(0, 2000) : null,
    }));

  if (normalised.length === 0) return [];

  const { data, error } = await client.rpc("claim_resources", {
    p_session_id: sessionId,
    p_resources: normalised,
    p_ttl_seconds: ttlSeconds,
  });

  if (error) {
    throw new RepositoryError(`Failed to claim resources: ${error.message}`);
  }

  return (data ?? []) as ClaimOutcome[];
}

export async function releaseClaims(
  client: SupabaseClient,
  sessionId: string,
  resources?: string[]
): Promise<number> {
  const { data, error } = await client.rpc("release_claims", {
    p_session_id: sessionId,
    p_resources: resources && resources.length > 0 ? resources : null,
  });

  if (error) {
    throw new RepositoryError(`Failed to release claims: ${error.message}`);
  }
  return (data as number) ?? 0;
}

/** Live claims across a project, keyed by session. */
async function loadLiveClaims(
  client: SupabaseClient,
  projectId: string
): Promise<Array<{ session_id: string; resource: string; intent: string | null; expires_at: string }>> {
  const { data, error } = await client
    .from("project_claims")
    .select("session_id, resource, intent, expires_at")
    .eq("project_id", projectId)
    .is("released_at", null)
    .gt("expires_at", new Date().toISOString());

  if (error) {
    throw new RepositoryError(`Failed to load claims: ${error.message}`);
  }
  return (data ?? []) as Array<{
    session_id: string;
    resource: string;
    intent: string | null;
    expires_at: string;
  }>;
}

// ─── Notices ────────────────────────────────────────────────────────────────

export async function postNotice(
  client: SupabaseClient,
  workspaceId: string,
  sessionId: string | null,
  input: {
    projectId: string;
    body: string;
    kind?: "broadcast" | "direct" | "alert" | "question" | "answer";
    toSessionId?: string | null;
    importance?: number;
  }
): Promise<{ id: string; created_at: string }> {
  const body = redactString(input.body ?? "").trim();
  if (!body) throw new ValidationError("Notice body is required");

  const kind = input.kind ?? "broadcast";
  const importance =
    input.importance !== undefined
      ? Math.max(0, Math.min(5, Math.round(input.importance)))
      // An alert is what interrupts; a broadcast is what informs.
      : kind === "alert"
        ? 5
        : 3;

  const { data, error } = await client
    .from("project_notices")
    .insert({
      workspace_id: workspaceId,
      project_id: input.projectId,
      from_session_id: sessionId,
      to_session_id: input.toSessionId ?? null,
      kind,
      body: body.slice(0, 4000),
      importance,
    })
    .select("id, created_at")
    .single();

  if (error) {
    throw new RepositoryError(`Failed to post notice: ${error.message}`);
  }

  dispatchEvent(client, workspaceId, "notice.posted", {
    project_id: input.projectId,
    from_session_id: sessionId,
    to_session_id: input.toSessionId ?? null,
    kind,
    body: body.slice(0, 500),
    importance,
  });

  return data as { id: string; created_at: string };
}

/** Mark a question answered so it stops surfacing in check-ins. */
export async function answerNotice(
  client: SupabaseClient,
  workspaceId: string,
  noticeId: string
): Promise<void> {
  const { error } = await client
    .from("project_notices")
    .update({ answered_at: new Date().toISOString() })
    .eq("id", noticeId)
    .eq("workspace_id", workspaceId);

  if (error) {
    throw new RepositoryError(`Failed to answer notice: ${error.message}`);
  }
}

// ─── Check-in ───────────────────────────────────────────────────────────────

export interface CheckInRequest {
  /** One line: what this agent is doing right now. Shown to every peer. */
  intent?: string;
  claim?: ClaimRequest[];
  release?: string[];
  ttl_seconds?: number;
}

/**
 * The check-in.
 *
 * Order of operations matters and is deliberate:
 *
 *   1. Release first, so an agent can hand something over and claim its
 *      replacement in one call without fighting itself for the resource.
 *   2. Claim second, so the outcomes reflect the post-release world.
 *   3. Read the world third, so peers and conflicts include what just changed.
 *   4. Advance the cursor last, and only after the delta has been assembled —
 *      if anything above throws, the agent re-reads rather than silently losing
 *      the window.
 */
export async function checkIn(
  client: SupabaseClient,
  workspaceId: string,
  sessionId: string,
  request: CheckInRequest = {}
): Promise<CheckInResult> {
  const session = await getSessionById(client, sessionId);
  if (!session || session.workspace_id !== workspaceId) {
    throw new ValidationError(`Session ${sessionId} not found`);
  }

  const now = new Date();
  const since = session.last_checkin_at ?? session.started_at;

  // 1 & 2 — release then claim.
  if (request.release?.length) {
    await releaseClaims(client, sessionId, request.release);
  }

  let claimOutcomes: ClaimOutcome[] = [];
  if (request.claim?.length) {
    claimOutcomes = await claimResources(
      client,
      sessionId,
      request.claim,
      request.ttl_seconds ?? DEFAULT_CLAIM_TTL_SECONDS
    );
  }

  // 3 — read the world.
  // Interpreting silence as idleness before listing peers keeps a capped agent
  // from appearing live to everyone else indefinitely.
  await markStaleSessionsIdle(client, session.project_id, SESSION_IDLE_AFTER_MS).catch(
    () => 0
  );

  const [peers, claims, events, notices, questions] = await Promise.all([
    loadPeers(client, session),
    loadLiveClaims(client, session.project_id),
    loadDeltaEvents(client, session, since),
    loadDeltaNotices(client, session, since),
    loadOpenQuestions(client, session),
  ]);

  const claimsBySession = new Map<string, string[]>();
  for (const claim of claims) {
    const list = claimsBySession.get(claim.session_id) ?? [];
    list.push(claim.resource);
    claimsBySession.set(claim.session_id, list);
  }

  const peerList: PeerAgent[] = peers.map((peer) => ({
    session_id: peer.id,
    agent_tool: peer.agent_tool,
    agent_model: peer.agent_model,
    account_label: peer.account_label,
    status: peer.status,
    current_intent: peer.current_intent ?? null,
    git_branch: peer.git_branch,
    last_seen_at: peer.last_seen_at,
    claims: claimsBySession.get(peer.id) ?? [],
  }));

  const peerLabels = new Map(peerList.map((p) => [p.session_id, labelFor(p)]));

  const conflicts = detectConflicts({
    sessionId,
    myClaims: claims.filter((c) => c.session_id === sessionId),
    events,
    claimOutcomes,
    peerLabels,
  });

  // A refused claim is worth telling the other side about: the holder can
  // decide to release early rather than making the newcomer wait out a TTL.
  for (const outcome of claimOutcomes) {
    if (!outcome.granted && outcome.held_by) {
      dispatchEvent(client, workspaceId, "claim.conflict", {
        project_id: session.project_id,
        resource: outcome.resource,
        requested_by: sessionId,
        held_by: outcome.held_by,
        held_intent: outcome.held_intent,
      });
    }
  }

  // 4 — advance liveness and the cursor together, last.
  //
  // One write, after the delta is assembled: if anything above threw, the
  // cursor has not moved and the agent re-reads the window next time rather
  // than silently losing it. Duplicated context is recoverable; skipped
  // context is not.
  try {
    await updateSession(client, sessionId, {
      last_seen_at: now.toISOString(),
      status: session.status === "idle" ? "active" : session.status,
      last_checkin_at: now.toISOString(),
      checkin_count: (session.checkin_count ?? 0) + 1,
      ...(request.intent !== undefined
        ? { current_intent: redactString(request.intent).slice(0, 2000) }
        : {}),
    });
  } catch (err) {
    // The agent still gets its delta; only the cursor failed to advance.
    logger.warn({ err, sessionId }, "Failed to advance check-in cursor");
  }

  return {
    session_id: sessionId,
    checked_in_at: now.toISOString(),
    holding: claims
      .filter((c) => c.session_id === sessionId)
      .map((c) => ({ resource: c.resource, expires_at: c.expires_at })),
    claim_outcomes: claimOutcomes.map((outcome) => ({
      ...outcome,
      held_by_label: outcome.held_by ? peerLabels.get(outcome.held_by) ?? null : null,
    })),
    peers: peerList,
    events,
    notices,
    conflicts,
    open_questions: questions,
    next_checkin_after_seconds: SUGGESTED_CHECKIN_SECONDS,
  };
}

async function loadPeers(
  client: SupabaseClient,
  session: AgentSession
): Promise<
  Array<
    Pick<
      AgentSession,
      | "id"
      | "agent_tool"
      | "agent_model"
      | "account_label"
      | "status"
      | "git_branch"
      | "last_seen_at"
    > & { current_intent: string | null }
  >
> {
  const { data, error } = await client
    .from("agent_sessions")
    .select(
      "id, agent_tool, agent_model, account_label, status, git_branch, last_seen_at, current_intent"
    )
    .eq("project_id", session.project_id)
    .neq("id", session.id)
    .neq("status", "ended")
    .order("last_seen_at", { ascending: false })
    .limit(25);

  if (error) {
    throw new RepositoryError(`Failed to load peer agents: ${error.message}`);
  }
  return (data ?? []) as Array<
    Pick<
      AgentSession,
      | "id"
      | "agent_tool"
      | "agent_model"
      | "account_label"
      | "status"
      | "git_branch"
      | "last_seen_at"
    > & { current_intent: string | null }
  >;
}

async function loadDeltaEvents(
  client: SupabaseClient,
  session: AgentSession,
  since: string
): Promise<CheckInResult["events"]> {
  const events = await listRecentEventsForProject(client, session.project_id, {
    limit: MAX_DELTA_EVENTS * 2,
    since,
    minImportance: DELTA_IMPORTANCE_FLOOR,
  });

  return events
    // An agent's own events are not news to it.
    .filter((event) => event.session_id !== session.id)
    .slice(0, MAX_DELTA_EVENTS)
    .map((event) => ({
      session_id: event.session_id,
      event_type: event.event_type,
      summary: event.summary,
      importance: event.importance,
      files: event.files,
      occurred_at: event.occurred_at,
    }));
}

async function loadDeltaNotices(
  client: SupabaseClient,
  session: AgentSession,
  since: string
): Promise<CheckInResult["notices"]> {
  const { data, error } = await client
    .from("project_notices")
    .select("id, from_session_id, to_session_id, kind, body, importance, created_at")
    .eq("project_id", session.project_id)
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_DELTA_NOTICES * 2);

  if (error) {
    throw new RepositoryError(`Failed to load notices: ${error.message}`);
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((notice) => {
      // Skip our own, and anything addressed to somebody else.
      if (notice.from_session_id === session.id) return false;
      const to = notice.to_session_id as string | null;
      return to === null || to === session.id;
    })
    .slice(0, MAX_DELTA_NOTICES)
    .map((notice) => ({
      id: notice.id as string,
      from_session_id: (notice.from_session_id as string) ?? null,
      kind: notice.kind as string,
      body: notice.body as string,
      importance: notice.importance as number,
      created_at: notice.created_at as string,
    }));
}

/**
 * Unanswered questions on the project, regardless of age.
 *
 * Not filtered by the check-in cursor: a question nobody answered is still open
 * whether it was asked two minutes or two hours ago, and letting it scroll out
 * of the delta window is how questions get silently dropped.
 */
async function loadOpenQuestions(
  client: SupabaseClient,
  session: AgentSession
): Promise<CheckInResult["open_questions"]> {
  const { data, error } = await client
    .from("project_notices")
    .select("id, body, from_session_id")
    .eq("project_id", session.project_id)
    .eq("kind", "question")
    .is("answered_at", null)
    .neq("from_session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    logger.warn({ err: error }, "Failed to load open questions");
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    body: row.body as string,
    from_session_id: (row.from_session_id as string) ?? null,
  }));
}

/**
 * Work out what the agent needs warning about.
 *
 * Two directions, both of which matter:
 *
 *   - Someone edited a file I claimed. I may be about to overwrite their work,
 *     or build on a stale read of it.
 *   - I asked for something someone else holds. I should coordinate rather than
 *     barge in.
 */
function detectConflicts(args: {
  sessionId: string;
  myClaims: Array<{ resource: string }>;
  events: CheckInResult["events"];
  claimOutcomes: ClaimOutcome[];
  peerLabels: Map<string, string>;
}): Conflict[] {
  const { myClaims, events, claimOutcomes, peerLabels } = args;
  const conflicts: Conflict[] = [];
  const seen = new Set<string>();

  for (const claim of myClaims) {
    for (const event of events) {
      for (const file of event.files) {
        if (!resourceOverlaps(claim.resource, file)) continue;
        const key = `edited:${claim.resource}:${file}:${event.session_id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        conflicts.push({
          resource: file,
          reason: "someone_edited_my_claim",
          other_session_id: event.session_id,
          other_label: peerLabels.get(event.session_id) ?? null,
          detail:
            `${peerLabels.get(event.session_id) ?? "Another agent"} touched ${file}, ` +
            `which is inside your claim on ${claim.resource}: ${event.summary}`,
        });
      }
    }
  }

  for (const outcome of claimOutcomes) {
    if (outcome.granted) continue;
    conflicts.push({
      resource: outcome.resource,
      reason: "my_claim_request_refused",
      other_session_id: outcome.held_by,
      other_label: outcome.held_by
        ? peerLabels.get(outcome.held_by) ?? null
        : null,
      detail:
        `${outcome.resource} is held by ` +
        `${(outcome.held_by && peerLabels.get(outcome.held_by)) ?? "another agent"}` +
        `${outcome.held_intent ? ` who is: ${outcome.held_intent}` : ""}. ` +
        `Their claim expires at ${outcome.expires_at}.`,
    });
  }

  return conflicts;
}

/** Live roster for a project — used by the dashboard and the sessions API. */
export async function listActiveAgents(
  client: SupabaseClient,
  projectId: string
): Promise<PeerAgent[]> {
  await markStaleSessionsIdle(client, projectId, SESSION_IDLE_AFTER_MS).catch(() => 0);

  const { data, error } = await client
    .from("agent_sessions")
    .select(
      "id, agent_tool, agent_model, account_label, status, git_branch, last_seen_at, current_intent"
    )
    .eq("project_id", projectId)
    .neq("status", "ended")
    .order("last_seen_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new RepositoryError(`Failed to list active agents: ${error.message}`);
  }

  const claims = await loadLiveClaims(client, projectId);
  const bySession = new Map<string, string[]>();
  for (const claim of claims) {
    const list = bySession.get(claim.session_id) ?? [];
    list.push(claim.resource);
    bySession.set(claim.session_id, list);
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    session_id: row.id as string,
    agent_tool: row.agent_tool as string,
    agent_model: (row.agent_model as string) ?? null,
    account_label: (row.account_label as string) ?? null,
    status: row.status as string,
    current_intent: (row.current_intent as string) ?? null,
    git_branch: (row.git_branch as string) ?? null,
    last_seen_at: row.last_seen_at as string,
    claims: bySession.get(row.id as string) ?? [],
  }));
}
