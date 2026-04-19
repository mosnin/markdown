import { type NextRequest } from "next/server";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

/**
 * POST /api/agent/tools/trace
 *
 * Internal endpoint invoked by the Workspace Operator (Modal Python agent)
 * via its custom `PoggleTracingProcessor`. Every tool call, LLM call, and
 * guardrail event emitted by the OpenAI Agents SDK is forwarded here so
 * we can:
 *
 *   1. Write a durable row into `audit_events` (the existing audit log)
 *      using actor_type='system', actor_id='workspace_operator' — the
 *      Modal agent is a shared system process, not a workspace member.
 *   2. For *interesting* events (root trace start/end, guardrail trips)
 *      we additionally broadcast an `activity_feed` event via Supabase
 *      Realtime so the user's activity feed updates in near-real-time.
 *      Noisy span chatter (LLM calls, inner spans) is written only to
 *      the durable audit log.
 *
 * Accepts a single event object OR a batched `{ events: [...] }` payload.
 * Always returns 200 on partial ingest — a trace POST must never abort
 * a run, mirroring the fire-and-forget contract on the Python side.
 */

const SYSTEM_ACTOR_ID = "workspace_operator";

// Event kinds that deserve a real-time broadcast to the user's feed.
// Keep this tight — noisy events kill feed usability. Everything else
// still writes to audit_events so operators can inspect the full trace.
const INTERESTING_KINDS = new Set<string>(["trace_root", "guardrail"]);

export interface TraceEventInput {
  run_id?: string;
  span_id?: string;
  parent_id?: string | null;
  name?: string;
  kind?: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  metadata?: Record<string, unknown> | null;
}

export async function POST(request: NextRequest) {
  const auth = verifyAgentRequest(request);
  if (!auth.ok) {
    switch (auth.failure.kind) {
      case "feature_disabled":
        return apiError("feature_disabled", "Workspace Operator is not enabled", 400);
      case "missing_secret":
        return apiError(
          "server_misconfigured",
          "Shared secret is not configured",
          500
        );
      case "invalid_secret":
        return apiError("invalid_secret", "Invalid shared secret", 403);
      case "missing_envelope":
        return E_BAD_REQUEST(`Missing required header: ${auth.failure.field}`);
      case "invalid_envelope":
        return E_BAD_REQUEST(
          `Invalid ${auth.failure.field}: ${auth.failure.reason}`
        );
    }
  }
  const { ctx } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const events = normalizeEvents(body);
  if (events === null) {
    return E_BAD_REQUEST(
      "Body must be a trace event object or { events: [...] } with at least one event"
    );
  }
  if (events.length === 0) {
    return E_BAD_REQUEST("events must be a non-empty array");
  }

  // Cross-check: every event's run_id must match the envelope's run_id.
  // The shared-secret trust model authenticates the envelope; we won't
  // let a caller smuggle events for a different run through this route.
  for (const ev of events) {
    if (!ev.run_id || typeof ev.run_id !== "string") {
      return E_BAD_REQUEST("each event requires a run_id string");
    }
    if (ev.run_id !== ctx.runId) {
      return E_BAD_REQUEST(
        "event run_id does not match the envelope run_id"
      );
    }
  }

  const admin = createAdminClient();

  let written = 0;
  let broadcast = 0;

  for (const ev of events) {
    const kind = typeof ev.kind === "string" ? ev.kind : "span";
    const name = typeof ev.name === "string" ? ev.name : "(unnamed)";

    try {
      await createAuditEvent(admin, {
        workspace_id: ctx.workspaceId,
        actor_type: "system",
        actor_id: SYSTEM_ACTOR_ID,
        object_type: "agent_run",
        object_id: ctx.runId,
        event_type: `agent.trace.${kind}`,
        metadata: {
          run_id: ctx.runId,
          span_id: ev.span_id ?? null,
          parent_id: ev.parent_id ?? null,
          name,
          kind,
          started_at: ev.started_at ?? null,
          ended_at: ev.ended_at ?? null,
          duration_ms: ev.duration_ms ?? null,
          span_metadata: ev.metadata ?? null,
        },
      });
      written += 1;
    } catch (err) {
      // Partial failure: keep ingesting remaining events rather than
      // returning 500. A failing audit insert is a last-mile problem;
      // we log it but do not break the run on the Python side.
      console.error(
        "[agent_tools_trace] failed to write audit_event",
        err,
        { run_id: ctx.runId, span_id: ev.span_id, kind }
      );
      continue;
    }

    // Broadcast to the per-run activity feed channel for interesting
    // events only. "Interesting" = trace lifecycle (root start/end) and
    // any guardrail event (always worth surfacing).
    const isGuardrailByName =
      typeof ev.name === "string" && ev.name.toLowerCase().includes("guardrail");
    if (INTERESTING_KINDS.has(kind) || isGuardrailByName) {
      try {
        const channel = admin.channel(`activity_feed:${ctx.workspaceId}`);
        await channel.send({
          type: "broadcast",
          event: "agent_trace",
          payload: {
            workspace_id: ctx.workspaceId,
            run_id: ctx.runId,
            span_id: ev.span_id ?? null,
            kind,
            name,
            started_at: ev.started_at ?? null,
            ended_at: ev.ended_at ?? null,
            duration_ms: ev.duration_ms ?? null,
            metadata: ev.metadata ?? null,
          },
        });
        broadcast += 1;
      } catch (err) {
        // Broadcast failure is non-fatal — the audit row is already
        // durable, the UI will pick it up on the next poll / refresh.
        console.error(
          "[agent_tools_trace] failed to broadcast feed event",
          err
        );
      }
    }
  }

  if (written === 0) {
    return E_INTERNAL("Failed to persist any trace events");
  }

  return apiOk({
    run_id: ctx.runId,
    received: events.length,
    written,
    broadcast,
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Accept either a single event object or a batch `{ events: [...] }`.
 * Returns an array of TraceEventInput, or null if the shape is invalid.
 */
function normalizeEvents(body: unknown): TraceEventInput[] | null {
  if (!body || typeof body !== "object") return null;

  const record = body as Record<string, unknown>;

  if ("events" in record) {
    const raw = record.events;
    if (!Array.isArray(raw)) return null;
    const all: TraceEventInput[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") return null;
      all.push(item as TraceEventInput);
    }
    return all;
  }

  // Single-event shape — must look like an event (has at least a run_id).
  if (typeof record.run_id !== "string") return null;
  return [record as TraceEventInput];
}
