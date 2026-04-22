import { type NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { endBrowserbaseSession } from "@/server/services/browserbase_service";
import {
  getBrowsingSessionById,
  updateBrowsingSessionStatus,
} from "@/server/repositories/browsing_session_repository";

/**
 * POST /api/agent/tools/browse_session_end
 *
 * Terminates a browsing session. Idempotent: calling on an already
 * non-active session simply returns the current status without touching
 * Browserbase. Errors releasing the Browserbase session are swallowed —
 * the row is still marked completed so it stops appearing as active.
 */

export async function POST(request: NextRequest) {
  const auth = verifyAgentRequest(request);
  if (!auth.ok) {
    switch (auth.failure.kind) {
      case "feature_disabled":
        return apiError("feature_disabled", "Workspace Operator is not enabled", 404);
      case "missing_secret":
        return apiError("server_misconfigured", "Shared secret is not configured", 500);
      case "invalid_secret":
        return apiError("unauthorized", "Invalid shared secret", 401);
      case "missing_envelope":
        return E_BAD_REQUEST(`Missing required header: ${auth.failure.field}`);
      case "invalid_envelope":
        return E_BAD_REQUEST(
          `Invalid ${auth.failure.field}: ${auth.failure.reason}`
        );
    }
  }
  const { ctx } = auth;

  let body: { session_id?: string };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
  if (!sessionId) {
    return E_BAD_REQUEST("session_id is required and must be a non-empty string");
  }

  const supabase = createAdminClient();

  let session;
  try {
    session = await getBrowsingSessionById(supabase, sessionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return E_INTERNAL(`Failed to load browsing session: ${message}`);
  }
  if (!session) return apiError("not_found", "Browsing session not found", 404);
  if (session.workspace_id !== ctx.workspaceId) {
    return apiError("forbidden", "Browsing session does not belong to this workspace", 403);
  }

  if (session.status !== "active") {
    return apiOk({
      run_id: ctx.runId,
      session_id: session.id,
      status: session.status,
      page_count: session.page_count,
      total_cost_cents: session.total_cost_cents,
    });
  }

  try {
    await endBrowserbaseSession(session.browserbase_session_id);
  } catch {
    // swallow — we still mark the session completed in our DB
  }

  try {
    await updateBrowsingSessionStatus(supabase, session.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return E_INTERNAL(`Failed to update session: ${message}`);
  }

  return apiOk({
    run_id: ctx.runId,
    session_id: session.id,
    status: "completed",
    page_count: session.page_count,
    total_cost_cents: session.total_cost_cents,
  });
}
