import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRelayAuth } from "@/server/auth/relay_auth";
import { withApiHandler } from "@/server/api/with_api_handler";
import {
  apiOk,
  E_BAD_REQUEST,
  E_INSUFFICIENT_SCOPE,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import {
  ingestEvents,
  openOrResumeSession,
  type IngestEventRequest,
  type OpenSessionRequest,
} from "@/server/services/session_ingest_service";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/relay/events
 *
 * The ingest endpoint. Everything a hook observes arrives here.
 *
 * Body, either form:
 *
 *   { "session_id": "<uuid>", "events": [ ... ] }
 *   { "session": { project, external_id, ... }, "events": [ ... ] }
 *
 * The second form opens-or-resumes the session in the same round trip, which
 * is what the hook shims use: a PostToolUse hook has no way to know whether
 * the SessionStart hook ran, or whether its POST succeeded, and one request is
 * cheaper than two on a path that runs after every tool call.
 *
 * Idempotency: give each event a `client_event_id`. Replays are dropped
 * server-side without consuming a sequence number, so a hook can spool events
 * to disk and re-send the whole spool after the agent process was killed
 * mid-flight — which is exactly what happens at a usage cap.
 *
 * Auth: relay key, or OAuth token with `relay:write`.
 */
export const POST = withApiHandler(async (request: NextRequest) => {
  const ctx = await resolveRelayAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!ctx.canWrite) return E_INSUFFICIENT_SCOPE("relay:write");

  let body: {
    session_id?: string;
    session?: OpenSessionRequest;
    events?: IngestEventRequest[];
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  if (!Array.isArray(body.events) || body.events.length === 0) {
    return E_BAD_REQUEST("events must be a non-empty array");
  }

  const admin = createAdminClient();

  let sessionId = body.session_id;
  if (!sessionId) {
    if (!body.session) {
      return E_BAD_REQUEST("Either session_id or session must be provided");
    }
    const { session } = await openOrResumeSession(
      admin,
      ctx.workspaceId,
      body.session
    );
    sessionId = session.id;
  }

  const result = await ingestEvents(
    admin,
    ctx.workspaceId,
    sessionId,
    body.events
  );

  return apiOk(result, 202);
});
