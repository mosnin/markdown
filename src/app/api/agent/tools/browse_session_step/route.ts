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
import { browsingStepLimit } from "@/lib/api/rate_limit";
import { enforceWebBudget } from "@/server/services/web_budget_service";
import { runBrowserbaseStep } from "@/server/services/browserbase_service";
import {
  getBrowsingSessionById,
  recordBrowsingStep,
  updateBrowsingSessionStatus,
} from "@/server/repositories/browsing_session_repository";
import { recordWebToolUsage } from "@/server/repositories/web_tool_usage_repository";
import { createCitation } from "@/server/repositories/web_citation_repository";
import type { BrowsingStepAction } from "@/server/domain/types/web_tool";

/**
 * POST /api/agent/tools/browse_session_step
 *
 * Executes one action (navigate / click / fill / extract / screenshot)
 * against an existing browsing session. Persists the step, updates the
 * session counters, and for `extract` actions emits a citation so the
 * UI can surface where the agent read from.
 *
 * Cost: 1 cent per step (billed against the workspace web-tool budget).
 */

const STEP_COST_CENTS = 1;
const VALID_ACTIONS: readonly BrowsingStepAction[] = [
  "navigate",
  "click",
  "fill",
  "extract",
  "screenshot",
];

function isAction(v: unknown): v is BrowsingStepAction {
  return typeof v === "string" && (VALID_ACTIONS as readonly string[]).includes(v);
}

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

  let body: {
    session_id?: string;
    action?: string;
    url?: string;
    selector?: string;
    value?: string;
    extraction_mode?: string;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
  if (!sessionId) {
    return E_BAD_REQUEST("session_id is required and must be a non-empty string");
  }
  if (!isAction(body.action)) {
    return E_BAD_REQUEST(
      `action is required and must be one of ${VALID_ACTIONS.join(", ")}`
    );
  }
  const action = body.action;

  const extractionMode =
    body.extraction_mode === "full_html" || body.extraction_mode === "readable"
      ? body.extraction_mode
      : undefined;

  const supabase = createAdminClient();

  const rl = await browsingStepLimit(sessionId);
  if (!rl.allowed) return E_RATE_LIMITED(rl.retryAfter);

  const budgetBlocked = await enforceWebBudget(
    supabase,
    ctx.workspaceId,
    STEP_COST_CENTS
  );
  if (budgetBlocked) return budgetBlocked;

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
    return apiError("session_not_active", "session not active", 409);
  }

  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) {
    return apiError(
      "server_misconfigured",
      "BROWSERBASE_API_KEY is not configured",
      500
    );
  }
  // Browserbase's wss CDP endpoint takes the api key and session id as
  // query params — there is no cheaper way to re-derive the connect URL
  // from the session id without re-fetching the session from Browserbase.
  const connectUrl = `wss://connect.browserbase.com?apiKey=${encodeURIComponent(apiKey)}&sessionId=${encodeURIComponent(session.browserbase_session_id)}`;

  let step;
  try {
    step = await runBrowserbaseStep(connectUrl, {
      action,
      url: body.url,
      selector: body.selector,
      value: body.value,
      extraction_mode: extractionMode,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return apiError("step_failed", `Browserbase step failed: ${message}`, 502);
  }

  const nextStepNumber = session.page_count + 1;

  try {
    await recordBrowsingStep(supabase, {
      session_id: session.id,
      step_number: nextStepNumber,
      action,
      url: step.url,
      selector: body.selector ?? null,
      value: body.value ?? null,
      extracted_content: step.extracted_content,
      screenshot_url: step.screenshot_url,
      action_took_ms: step.action_took_ms,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return E_INTERNAL(`Failed to record step: ${message}`);
  }

  try {
    await updateBrowsingSessionStatus(supabase, session.id, {
      status: "active",
      page_count: nextStepNumber,
      total_cost_cents: session.total_cost_cents + STEP_COST_CENTS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return E_INTERNAL(`Failed to update session: ${message}`);
  }

  try {
    await recordWebToolUsage(supabase, {
      workspace_id: ctx.workspaceId,
      user_id: ctx.userId,
      tool_name: "browserbase_step",
      units: 1,
      cost_cents: STEP_COST_CENTS,
      metadata: { session_id: session.id, action },
    });
  } catch {
    // best-effort
  }

  if (action === "extract" && step.url && step.extracted_content) {
    try {
      await createCitation(supabase, {
        workspace_id: ctx.workspaceId,
        operator_run_id: null,
        source_type: "browserbase",
        url: step.url,
        title: null,
        excerpt: step.extracted_content.slice(0, 200),
      });
    } catch {
      // swallow — citations are a UI nicety, not load-bearing
    }
  }

  return apiOk({
    run_id: ctx.runId,
    step_number: nextStepNumber,
    url: step.url,
    extracted_content: step.extracted_content,
    screenshot_url: step.screenshot_url,
    action_took_ms: step.action_took_ms,
  });
}
