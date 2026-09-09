import { type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { ValidationError } from "@/server/domain/errors";
import {
  type AgentSession,
  type Project,
  type SessionEvent,
} from "@/server/domain/types/agent_session";
import {
  AGENT_TOOLS,
  DEFAULT_EVENT_IMPORTANCE,
  EVENT_ACTORS,
  MAX_EVENTS_PER_BATCH,
  MAX_EVENT_PAYLOAD_BYTES,
  SESSION_END_REASONS,
  SESSION_EVENT_TYPES,
  type AgentTool,
  type SessionEndReason,
  type SessionEventType,
} from "@/server/domain/constants/agent_session_constants";
import {
  ensureProject,
  toProjectSlug,
  incrementProjectSessionCount,
} from "@/server/repositories/project_repository";
import {
  closeSession,
  getSessionById,
  openSession,
  updateSession,
} from "@/server/repositories/agent_session_repository";
import {
  appendEvents,
  type EventInput,
} from "@/server/repositories/session_event_repository";
import {
  redactFilePaths,
  redactPayload,
  redactString,
} from "@/server/services/session_event_redaction";
import { dispatchEvent } from "@/server/services/content_webhook_service";

/**
 * Session ingest service.
 *
 * The write half of the relay. Everything a hook sends arrives here:
 *
 *   openOrResumeSession()  SessionStart / first event from a new agent run
 *   ingestEvents()         the steady stream of tool calls, edits, decisions
 *   endSession()           SessionEnd, or a cap detected by the shim
 *
 * Three properties this service must hold, in priority order:
 *
 *   1. It must not block the agent. Hooks run inline in the agent's own
 *      process; a slow ingest is felt as a slow agent. Webhook fan-out is
 *      fire-and-forget and never awaited.
 *   2. It must be idempotent. Hooks retry from an on-disk spool after the
 *      process was killed mid-flight, which is precisely the case we exist to
 *      serve — an agent hitting a usage cap is killed, then replays.
 *   3. It must not lose an event to a validation quibble. Unknown event types
 *      degrade to 'custom' and unparseable importance degrades to the default
 *      rather than 400-ing the batch. A partial log beats no log.
 */

// ─── Input shapes ───────────────────────────────────────────────────────────

export interface OpenSessionRequest {
  /** Repo URL, directory name, or explicit slug. Resolved to a project. */
  project: string;
  /** Display name for the project when we have to create it. */
  project_name?: string;
  repo_url?: string;
  /** Stable id from the agent runtime for the life of this run. */
  external_id: string;
  agent_tool?: string;
  agent_model?: string;
  /** Which plan/account/seat this run burns. Central to the relay story. */
  account_label?: string;
  agent_version?: string;
  host?: string;
  cwd?: string;
  git_branch?: string;
  git_commit?: string;
  title?: string;
  goal?: string;
  /** Set when this run was started from a brief off an earlier session. */
  resumed_from_session_id?: string;
  metadata?: Record<string, unknown>;
}

export interface IngestEventRequest {
  event_type?: string;
  summary?: string;
  payload?: unknown;
  actor?: string;
  tool_name?: string;
  files?: string[];
  importance?: number;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  client_event_id?: string;
  occurred_at?: string;
}

export interface IngestResult {
  session_id: string;
  accepted: number;
  duplicates: number;
  last_sequence: number;
}

// ─── Normalisation ──────────────────────────────────────────────────────────

const AGENT_TOOL_SET = new Set<string>(AGENT_TOOLS);
const EVENT_TYPE_SET = new Set<string>(SESSION_EVENT_TYPES);
const ACTOR_SET = new Set<string>(EVENT_ACTORS);
const END_REASON_SET = new Set<string>(SESSION_END_REASONS);

/** Max files we keep per event. A `git status` dump is not a file list. */
const MAX_FILES_PER_EVENT = 50;

function normaliseAgentTool(raw: string | undefined): AgentTool {
  if (!raw) return "custom";
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  return AGENT_TOOL_SET.has(key) ? (key as AgentTool) : "custom";
}

function normaliseEventType(raw: string | undefined): SessionEventType {
  if (!raw) return "custom";
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  return EVENT_TYPE_SET.has(key) ? (key as SessionEventType) : "custom";
}

export function normaliseEndReason(raw: string | undefined): SessionEndReason {
  if (!raw) return "unknown";
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  return END_REASON_SET.has(key) ? (key as SessionEndReason) : "unknown";
}

function clampImportance(
  raw: number | undefined,
  eventType: SessionEventType
): number {
  if (raw === undefined || raw === null || Number.isNaN(Number(raw))) {
    return DEFAULT_EVENT_IMPORTANCE[eventType];
  }
  return Math.max(0, Math.min(5, Math.round(Number(raw))));
}

function clampCount(raw: number | undefined): number {
  if (raw === undefined || raw === null || Number.isNaN(Number(raw))) return 0;
  const n = Math.round(Number(raw));
  return n > 0 ? n : 0;
}

/**
 * Turn one client event into a row the RPC will accept.
 *
 * Everything questionable is coerced rather than rejected. The one hard limit
 * is payload size: a payload over the cap is replaced with a marker, because
 * storing a 4MB stdout dump per tool call would make the log useless and
 * expensive at the same time.
 */
function normaliseEvent(raw: IngestEventRequest): EventInput {
  const eventType = normaliseEventType(raw.event_type);

  const summarySource =
    typeof raw.summary === "string" && raw.summary.trim().length > 0
      ? raw.summary.trim()
      : `${eventType} event`;
  // The column caps at 2000; leave room for the redaction markers.
  const summary = redactString(summarySource).slice(0, 1900);

  let payload = redactPayload(raw.payload);
  if (payload) {
    const size = Buffer.byteLength(JSON.stringify(payload), "utf8");
    if (size > MAX_EVENT_PAYLOAD_BYTES) {
      payload = {
        truncated: true,
        original_bytes: size,
        note: `Payload exceeded ${MAX_EVENT_PAYLOAD_BYTES} bytes and was dropped at ingest.`,
      };
    }
  }

  const files = Array.isArray(raw.files)
    ? redactFilePaths(
        raw.files.filter((f): f is string => typeof f === "string").slice(0, MAX_FILES_PER_EVENT)
      )
    : [];

  const actor =
    typeof raw.actor === "string" && ACTOR_SET.has(raw.actor) ? raw.actor : "agent";

  return {
    event_type: eventType,
    summary,
    payload,
    actor,
    tool_name: typeof raw.tool_name === "string" ? raw.tool_name.slice(0, 200) : null,
    files,
    importance: clampImportance(raw.importance, eventType),
    tokens_in: clampCount(raw.tokens_in),
    tokens_out: clampCount(raw.tokens_out),
    cost_usd:
      raw.cost_usd !== undefined && !Number.isNaN(Number(raw.cost_usd))
        ? Math.max(0, Number(raw.cost_usd))
        : 0,
    client_event_id:
      typeof raw.client_event_id === "string" && raw.client_event_id.length > 0
        ? raw.client_event_id.slice(0, 200)
        : null,
    occurred_at:
      typeof raw.occurred_at === "string" && !Number.isNaN(Date.parse(raw.occurred_at))
        ? new Date(raw.occurred_at).toISOString()
        : new Date().toISOString(),
  };
}

// ─── Session lifecycle ──────────────────────────────────────────────────────

/**
 * Resolve the project and open (or re-open) the session.
 *
 * Both halves are idempotent, so a hook may call this on every single event if
 * it cannot tell whether it has run before — which the Codex shim, lacking a
 * dedicated start hook, actually does.
 */
export async function openOrResumeSession(
  client: SupabaseClient,
  workspaceId: string,
  request: OpenSessionRequest
): Promise<{ project: Project; session: AgentSession; created: boolean }> {
  const slug = toProjectSlug(request.project ?? "");
  if (!slug) {
    throw new ValidationError(
      "project must contain at least one alphanumeric character"
    );
  }
  if (!request.external_id || request.external_id.trim().length === 0) {
    throw new ValidationError("external_id is required");
  }

  const project = await ensureProject(client, {
    workspace_id: workspaceId,
    name: (request.project_name ?? slug).slice(0, 200),
    slug,
    repo_url: request.repo_url ?? null,
    default_branch: request.git_branch ?? null,
  });

  const { session, created } = await openSession(client, {
    workspace_id: workspaceId,
    project_id: project.id,
    external_id: request.external_id.trim().slice(0, 200),
    agent_tool: normaliseAgentTool(request.agent_tool),
    agent_model: request.agent_model ?? null,
    account_label: request.account_label ?? null,
    agent_version: request.agent_version ?? null,
    host: request.host ?? null,
    cwd: request.cwd ? redactFilePaths([request.cwd])[0] : null,
    git_branch: request.git_branch ?? null,
    git_commit: request.git_commit ?? null,
    title: request.title ?? null,
    goal: request.goal ?? null,
    resumed_from_session_id: request.resumed_from_session_id ?? null,
    metadata: request.metadata ?? null,
  });

  if (created) {
    // Counter drift here is cosmetic; never fail an agent's first event for it.
    void incrementProjectSessionCount(client, project.id).catch(() => {});
    dispatchEvent(client, workspaceId, "session.started", {
      session_id: session.id,
      project_id: project.id,
      project_slug: project.slug,
      agent_tool: session.agent_tool,
      account_label: session.account_label,
      title: session.title,
      goal: session.goal,
    });
  }

  return { project, session, created };
}

/**
 * Append a batch of events to a session.
 *
 * The RPC does the sequencing and duplicate suppression; this function's job
 * is normalisation before, and fan-out after. Webhook dispatch only covers
 * genuinely new rows, so a spool replay does not re-notify anyone.
 */
export async function ingestEvents(
  client: SupabaseClient,
  workspaceId: string,
  sessionId: string,
  events: IngestEventRequest[]
): Promise<IngestResult> {
  if (!Array.isArray(events) || events.length === 0) {
    throw new ValidationError("events must be a non-empty array");
  }
  if (events.length > MAX_EVENTS_PER_BATCH) {
    throw new ValidationError(
      `Batch too large: ${events.length} events (max ${MAX_EVENTS_PER_BATCH})`
    );
  }

  const session = await getSessionById(client, sessionId);
  if (!session) {
    throw new ValidationError(`Session ${sessionId} not found`);
  }
  // Cross-tenant guard: the token's workspace must own the session. Without
  // this, a valid token from workspace A could append to workspace B's session
  // by guessing a uuid.
  if (session.workspace_id !== workspaceId) {
    throw new ValidationError(`Session ${sessionId} not found`);
  }

  const normalised = events.map(normaliseEvent);
  const inserted = await appendEvents(client, sessionId, normalised);

  const duplicates = normalised.length - inserted.length;

  if (inserted.length > 0) {
    fanOutEvents(client, workspaceId, session, inserted);
  }

  const lastSequence = inserted.length
    ? Math.max(...inserted.map((e) => e.sequence))
    : session.event_count;

  return {
    session_id: sessionId,
    accepted: inserted.length,
    duplicates,
    last_sequence: lastSequence,
  };
}

/**
 * Notify the outside world about newly logged events.
 *
 * Deliberately not awaited by the caller. Two channels:
 *   - Supabase Realtime broadcast, which the dashboard and the SSE route
 *     subscribe to for the live timeline.
 *   - Content webhooks, for anything outside this app.
 *
 * High-salience events get their own webhook so an integration can subscribe
 * to "tell me when an agent is blocked or capped" without drinking from the
 * whole firehose.
 */
function fanOutEvents(
  client: SupabaseClient,
  workspaceId: string,
  session: AgentSession,
  events: SessionEvent[]
): void {
  const channelName = `project:${session.project_id}`;

  void (async () => {
    try {
      const channel = client.channel(channelName, {
        config: { broadcast: { ack: false } },
      });
      await channel.subscribe();
      for (const event of events) {
        await channel.send({
          type: "broadcast",
          event: "session_event",
          payload: {
            id: event.id,
            session_id: event.session_id,
            sequence: event.sequence,
            event_type: event.event_type,
            summary: event.summary,
            actor: event.actor,
            tool_name: event.tool_name,
            files: event.files,
            importance: event.importance,
            occurred_at: event.occurred_at,
          },
        });
      }
      await client.removeChannel(channel);
    } catch (err) {
      logger.warn({ err, channelName }, "Realtime broadcast for session events failed");
    }
  })();

  for (const event of events) {
    dispatchEvent(client, workspaceId, "session.event", {
      session_id: event.session_id,
      project_id: event.project_id,
      sequence: event.sequence,
      event_type: event.event_type,
      summary: event.summary,
      importance: event.importance,
      occurred_at: event.occurred_at,
    });

    // A blocker or a cap is the moment a human may need to intervene.
    if (event.importance >= 5) {
      dispatchEvent(client, workspaceId, "session.attention", {
        session_id: event.session_id,
        project_id: event.project_id,
        event_type: event.event_type,
        summary: event.summary,
        agent_tool: session.agent_tool,
        account_label: session.account_label,
      });
    }
  }
}

/**
 * End a session.
 *
 * `usage_capped` additionally fires `session.capped`, which is the hook a
 * team wires to Slack: "Claude Code on plan A just capped mid-task, here is
 * the brief for whoever picks it up."
 */
export async function endSession(
  client: SupabaseClient,
  workspaceId: string,
  sessionId: string,
  endReasonRaw: string | undefined
): Promise<AgentSession> {
  const session = await getSessionById(client, sessionId);
  if (!session || session.workspace_id !== workspaceId) {
    throw new ValidationError(`Session ${sessionId} not found`);
  }

  const endReason = normaliseEndReason(endReasonRaw);
  const closed = await closeSession(client, sessionId, endReason);

  dispatchEvent(client, workspaceId, "session.ended", {
    session_id: closed.id,
    project_id: closed.project_id,
    end_reason: closed.end_reason,
    agent_tool: closed.agent_tool,
    account_label: closed.account_label,
    event_count: closed.event_count,
  });

  if (endReason === "usage_capped") {
    dispatchEvent(client, workspaceId, "session.capped", {
      session_id: closed.id,
      project_id: closed.project_id,
      agent_tool: closed.agent_tool,
      account_label: closed.account_label,
      title: closed.title,
      goal: closed.goal,
    });
  }

  return closed;
}

/** Refresh liveness without logging an event. Used by the CLI's heartbeat. */
export async function touchSession(
  client: SupabaseClient,
  workspaceId: string,
  sessionId: string
): Promise<AgentSession> {
  const session = await getSessionById(client, sessionId);
  if (!session || session.workspace_id !== workspaceId) {
    throw new ValidationError(`Session ${sessionId} not found`);
  }
  return updateSession(client, sessionId, {
    last_seen_at: new Date().toISOString(),
    status: session.status === "idle" ? "active" : session.status,
  });
}
