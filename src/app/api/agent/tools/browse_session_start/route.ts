import { type NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_RATE_LIMITED,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { browsingSessionLimit } from "@/lib/api/rate_limit";
import { enforceWebBudget } from "@/server/services/web_budget_service";
import { startBrowserbaseSession } from "@/server/services/browserbase_service";
import { createBrowsingSession } from "@/server/repositories/browsing_session_repository";
import { recordWebToolUsage } from "@/server/repositories/web_tool_usage_repository";

/**
 * POST /api/agent/tools/browse_session_start
 *
 * Starts a Browserbase-backed browsing session for the agent and returns
 * OUR internal `session_id` (the `browsing_sessions.id` UUID). Subsequent
 * step/end calls reference this internal id — the Browserbase external id
 * is held inside the row and never crosses the tool boundary directly.
 *
 * Cost: 5 cents per session start (billed up-front against the workspace
 * web-tool budget).
 */

const SESSION_START_COST_CENTS = 5;

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

  let body: { goal?: string };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const goal = typeof body.goal === "string" ? body.goal : null;

  const supabase = createAdminClient();

  const rl = await browsingSessionLimit(ctx.workspaceId);
  if (!rl.allowed) return E_RATE_LIMITED(rl.retryAfter);

  const budgetBlocked = await enforceWebBudget(
    supabase,
    ctx.workspaceId,
    SESSION_START_COST_CENTS
  );
  if (budgetBlocked) return budgetBlocked;

  let bbInfo;
  try {
    bbInfo = await startBrowserbaseSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return apiError(
      "browserbase_unavailable",
      `Failed to start Browserbase session: ${message}`,
      502
    );
  }

  let session;
  try {
    session = await createBrowsingSession(supabase, {
      workspace_id: ctx.workspaceId,
      user_id: ctx.userId,
      operator_run_id: null,
      browserbase_session_id: bbInfo.sessionId,
      goal,
      live_url: bbInfo.liveUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return E_INTERNAL(`Failed to record browsing session: ${message}`);
  }

  try {
    await recordWebToolUsage(supabase, {
      workspace_id: ctx.workspaceId,
      user_id: ctx.userId,
      tool_name: "browserbase_session",
      units: 1,
      cost_cents: SESSION_START_COST_CENTS,
      metadata: { action: "start", goal },
    });
  } catch {
    // Usage logging is best-effort — the session was created successfully.
  }

  return apiOk({
    run_id: ctx.runId,
    session_id: session.id,
    browserbase_session_id: bbInfo.sessionId,
    live_url: bbInfo.liveUrl,
  });
}
