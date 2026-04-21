import { type NextRequest } from "next/server";
import { apiOk, apiError, E_INTERNAL } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  recordEvent,
  type OperatorRunEventType,
} from "@/server/services/operator_run_events_service";

/**
 * POST /api/agent/operator/tool_call_event
 *
 * Structured event-stream endpoint invoked by the Workspace Operator
 * (Modal Python agent) during a run. Each call persists a row in
 * `operator_run_events` (durable, ordered by per-run sequence) AND
 * broadcasts the event to the Realtime channel the run-detail UI is
 * subscribed to.
 *
 * This is richer than `/api/agent/tools/progress`:
 *   - the event_type is from a closed allow-list that mirrors the DB
 *     CHECK constraint, so typos fail loudly at the edge,
 *   - we persist the event and return the assigned `sequence` so the
 *     agent can correlate later ack/poll work against it,
 *   - we enforce the envelope's (run_id, workspace_id) match so a rogue
 *     run_id can't drop events onto a workspace it doesn't belong to.
 *
 * Body: { event_type, tool_call_id?, tool_name?, step_index?, payload?,
 *         elapsed_ms?, input_tokens?, output_tokens? }
 */

// Per the AGENTS spec this route accepts a specific subset of event types.
// The service layer accepts a broader set (including plan_ready, etc.) — we
// validate against this narrower allow-list at the edge so agent-side bugs
// surface as clean 400s rather than confusing passes.
const ALLOWED_EVENT_TYPES = new Set<OperatorRunEventType>([
  "run_start",
  "run_end",
  "step_start",
  "step_complete",
  "tool_call_start",
  "tool_call_end",
  "tool_call_error",
  "tool_call_preview_diff",
  "llm_call_start",
  "llm_call_end",
  "usage_update",
  "note_drafted",
  "guardrail_tripped",
  "subagent_start",
  "subagent_end",
  "completed",
  "failed",
  "cancelled",
  "steer_message_received",
]);

interface Body {
  event_type?: string;
  tool_call_id?: string | null;
  tool_name?: string | null;
  step_index?: number | null;
  payload?: unknown;
  elapsed_ms?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
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
        return apiError(
          "bad_request",
          `Missing required header: ${auth.failure.field}`,
          400
        );
      case "invalid_envelope":
        return apiError(
          "bad_request",
          `Invalid ${auth.failure.field}: ${auth.failure.reason}`,
          400
        );
    }
  }
  const { ctx } = auth;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return apiError("bad_request", "Invalid JSON body", 400);
  }

  const eventType = body.event_type;
  if (!eventType || typeof eventType !== "string") {
    return apiError("bad_request", "event_type is required", 400);
  }
  if (!ALLOWED_EVENT_TYPES.has(eventType as OperatorRunEventType)) {
    return apiError(
      "bad_request",
      `Unsupported event_type: ${eventType}`,
      400
    );
  }

  const admin = createAdminClient();

  try {
    // Defense in depth: the envelope's run_id must actually belong to the
    // envelope's workspace. Without this, a leaked secret + any run_id
    // could redirect events to unrelated workspaces.
    const { data: runRow, error: runErr } = await admin
      .from("workspace_operator_runs")
      .select("workspace_id")
      .eq("id", ctx.runId)
      .single();
    if (runErr || !runRow || runRow.workspace_id !== ctx.workspaceId) {
      return apiError(
        "run_mismatch",
        "run_id does not belong to the authenticated workspace",
        403
      );
    }

    const row = await recordEvent(admin, {
      runId: ctx.runId,
      workspaceId: ctx.workspaceId,
      eventType: eventType as OperatorRunEventType,
      toolName: body.tool_name ?? null,
      toolCallId: body.tool_call_id ?? null,
      stepIndex: body.step_index ?? null,
      payload: body.payload ?? {},
      elapsedMs: body.elapsed_ms ?? null,
      inputTokens: body.input_tokens ?? null,
      outputTokens: body.output_tokens ?? null,
    });

    // Broadcast is fire-and-forget; we don't want a Realtime hiccup to
    // mask a successful DB write. The UI re-hydrates from the events table
    // if it misses a broadcast.
    await admin.channel(`operator_run:${ctx.runId}`).send({
      type: "broadcast",
      event: "event",
      payload: {
        id: row.id,
        run_id: row.run_id,
        workspace_id: row.workspace_id,
        sequence: row.sequence,
        event_type: row.event_type,
        tool_name: row.tool_name,
        tool_call_id: row.tool_call_id,
        step_index: row.step_index,
        payload: row.payload,
        elapsed_ms: row.elapsed_ms,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        created_at: row.created_at,
      },
    });

    return apiOk({ sequence: row.sequence, event_id: row.id });
  } catch (err) {
    console.error("[agent_operator_tool_call_event] failed", err);
    return E_INTERNAL();
  }
}
