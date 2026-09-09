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
  checkIn,
  type CheckInRequest,
  type ClaimRequest,
} from "@/server/services/coordination_service";
import {
  openOrResumeSession,
  type OpenSessionRequest,
} from "@/server/services/session_ingest_service";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/relay/checkin
 *
 * The multi-agent workhorse. One call that is simultaneously:
 *
 *   - a heartbeat ("I am alive, and here is what I am doing now")
 *   - a delta fetch ("what changed since I last asked")
 *   - a claim renewal ("keep holding what I claimed")
 *   - a conflict report ("did anyone walk into my territory, or I into theirs")
 *
 * Four calls collapsed into one deliberately. A coding agent is turn-based and
 * cannot hold a stream open between tool calls, so it polls — and an agent that
 * has to orchestrate a cursor, a lease timer and a subscription separately will
 * eventually drop one of them. One periodic call is a habit an agent can keep.
 *
 * Body (every field optional except session identification):
 *   { session_id | session,
 *     intent,            // one line: what you are doing right now
 *     claim: [{ resource, kind?, intent? }],
 *     release: ["path"],
 *     ttl_seconds }
 *
 * Auth: relay key, or OAuth token with `relay:write`.
 */
export const POST = withApiHandler(async (request: NextRequest) => {
  const ctx = await resolveRelayAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  // A check-in writes: it renews claims and moves the cursor.
  if (!ctx.canWrite) return E_INSUFFICIENT_SCOPE("relay:write");

  let body: {
    session_id?: string;
    session?: OpenSessionRequest;
    intent?: string;
    claim?: ClaimRequest[];
    release?: string[];
    ttl_seconds?: number;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const admin = createAdminClient();

  let sessionId = body.session_id;
  if (!sessionId) {
    if (!body.session) {
      return E_BAD_REQUEST("Either session_id or session must be provided");
    }
    // An agent that checks in before logging anything still gets a session, so
    // it appears in the roster to its peers from its first call.
    const { session } = await openOrResumeSession(
      admin,
      ctx.workspaceId,
      body.session
    );
    sessionId = session.id;
  }

  const checkInRequest: CheckInRequest = {
    intent: body.intent,
    claim: Array.isArray(body.claim) ? body.claim : undefined,
    release: Array.isArray(body.release) ? body.release : undefined,
    ttl_seconds:
      typeof body.ttl_seconds === "number" ? body.ttl_seconds : undefined,
  };

  const result = await checkIn(admin, ctx.workspaceId, sessionId, checkInRequest);

  return apiOk(result);
});
