import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRelayAuth } from "@/server/auth/relay_auth";
import { withApiHandler } from "@/server/api/with_api_handler";
import {
  apiOk,
  E_BAD_REQUEST,
  E_INSUFFICIENT_SCOPE,
  E_NOT_FOUND,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import {
  endSession,
  touchSession,
} from "@/server/services/session_ingest_service";
import { getSessionById } from "@/server/repositories/agent_session_repository";
import { listEventsForSession } from "@/server/repositories/session_event_repository";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ session_id: string }>;
}

/**
 * GET /api/v1/relay/sessions/[session_id]
 *
 * Read one session and a page of its events. Used by the dashboard's session
 * detail view and by an agent that wants the raw log rather than a brief.
 *
 * Auth: relay key, or OAuth token with `relay:read`.
 */
export const GET = withApiHandler(async (request: NextRequest, ctxParams) => {
  const auth = await resolveRelayAuth(request);
  if (!auth) return E_UNAUTHORIZED();
  if (!auth.canRead) return E_INSUFFICIENT_SCOPE("relay:read");

  const { session_id } = await (ctxParams as RouteParams).params;

  const admin = createAdminClient();
  const session = await getSessionById(admin, session_id);
  // Same 404 for "does not exist" and "belongs to another workspace": a
  // caller must not be able to probe for session ids across tenants.
  if (!session || session.workspace_id !== auth.workspaceId) {
    return E_NOT_FOUND("Session not found");
  }

  const url = new URL(request.url);
  const afterSequence = url.searchParams.get("after_sequence");
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit") ?? 200) || 200)
  );

  const events = await listEventsForSession(admin, session_id, {
    afterSequence: afterSequence ? Number(afterSequence) : undefined,
    limit,
  });

  return apiOk({ session, events });
});

/**
 * PATCH /api/v1/relay/sessions/[session_id]
 *
 * Two operations, chosen by the body:
 *
 *   { "action": "heartbeat" }
 *     Refresh liveness without writing an event. The CLI daemon calls this on
 *     a timer so a long-running tool call does not look like a dead session.
 *
 *   { "action": "end", "end_reason": "usage_capped" }
 *     Close the session. `usage_capped` additionally fires the
 *     `session.capped` webhook, which is the signal a team wires up to know
 *     that work was left unfinished and a handoff is due.
 *
 * Closing is idempotent and first-writer-wins on the reason: a shutdown hook
 * firing after a cap must not overwrite `usage_capped` with `completed`.
 *
 * Auth: relay key, or OAuth token with `relay:write`.
 */
export const PATCH = withApiHandler(async (request: NextRequest, ctxParams) => {
  const auth = await resolveRelayAuth(request);
  if (!auth) return E_UNAUTHORIZED();
  if (!auth.canWrite) return E_INSUFFICIENT_SCOPE("relay:write");

  const { session_id } = await (ctxParams as RouteParams).params;

  let body: { action?: string; end_reason?: string };
  try {
    body = (await request.json()) as { action?: string; end_reason?: string };
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const admin = createAdminClient();

  if (body.action === "heartbeat") {
    const session = await touchSession(admin, auth.workspaceId, session_id);
    return apiOk({ session_id: session.id, status: session.status });
  }

  if (body.action === "end") {
    const session = await endSession(
      admin,
      auth.workspaceId,
      session_id,
      body.end_reason
    );
    return apiOk({
      session_id: session.id,
      status: session.status,
      end_reason: session.end_reason,
      ended_at: session.ended_at,
      event_count: session.event_count,
    });
  }

  return E_BAD_REQUEST('action must be "heartbeat" or "end"');
});
