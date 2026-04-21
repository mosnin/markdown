import { type NextRequest } from "next/server";
import { apiOk, apiError, E_INTERNAL } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestApproval } from "@/server/services/tool_call_approvals_service";
import { recordEvent } from "@/server/services/operator_run_events_service";

/**
 * POST /api/agent/operator/approval/request
 *
 * The Python agent parks a pending human-in-the-loop approval for a
 * dangerous / gated tool call. Side effects, in order:
 *
 *   1. Insert a row in `tool_call_approvals` (status=pending).
 *   2. Record a `tool_call_approval_requested` event in `operator_run_events`
 *      so the run timeline reflects the pause.
 *   3. Flip `workspace_operator_runs.paused_at` / `paused_reason` so the
 *      list view shows the run as awaiting input.
 *   4. Broadcast on the operator_run Realtime channel so the UI updates
 *      without a round-trip.
 *
 * The agent then polls `/api/agent/operator/approval/poll` until the row
 * transitions to approved / rejected / timed_out.
 *
 * Body: { tool_call_id, tool_name, requested_args, preview?, timeout_seconds? }
 */

interface Body {
  tool_call_id?: string;
  tool_name?: string;
  requested_args?: unknown;
  preview?: unknown;
  timeout_seconds?: number | null;
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

  if (!body.tool_call_id || typeof body.tool_call_id !== "string") {
    return apiError("bad_request", "tool_call_id is required", 400);
  }
  if (!body.tool_name || typeof body.tool_name !== "string") {
    return apiError("bad_request", "tool_name is required", 400);
  }
  if (body.requested_args === undefined) {
    return apiError("bad_request", "requested_args is required", 400);
  }

  const admin = createAdminClient();

  try {
    // Defence-in-depth: the envelope run must belong to the envelope's
    // workspace. Without this, the insert would still target the right
    // run, but the run timeline <-> workspace consistency check would
    // be trusting a header instead of a DB fact.
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

    const timeoutAt =
      typeof body.timeout_seconds === "number" &&
      Number.isFinite(body.timeout_seconds) &&
      body.timeout_seconds > 0
        ? new Date(Date.now() + body.timeout_seconds * 1000).toISOString()
        : null;

    const approval = await requestApproval(admin, {
      runId: ctx.runId,
      workspaceId: ctx.workspaceId,
      toolCallId: body.tool_call_id,
      toolName: body.tool_name,
      requestedArgs: body.requested_args,
      preview: body.preview,
      timeoutAt,
    });

    // Record the timeline event. Best-effort — if this fails after the
    // approval row landed, the UI can still render the approval card from
    // the tool_call_approvals table; it just misses the event row.
    const eventRow = await recordEvent(admin, {
      runId: ctx.runId,
      workspaceId: ctx.workspaceId,
      eventType: "tool_call_approval_requested",
      toolName: body.tool_name,
      toolCallId: body.tool_call_id,
      payload: {
        approval_id: approval.id,
        preview: body.preview ?? null,
        timeout_at: timeoutAt,
      },
    });

    // Mark the run as paused so the list view reflects the state without
    // having to join against tool_call_approvals. The UpdateOperatorRunPatch
    // interface doesn't expose these fields yet, so write directly.
    const pausedAt = new Date().toISOString();
    const { error: pauseErr } = await admin
      .from("workspace_operator_runs")
      .update({
        paused_at: pausedAt,
        paused_reason: "awaiting_tool_approval",
      })
      .eq("id", ctx.runId);
    if (pauseErr) {
      // Non-fatal — the approval is already parked. Log and continue so
      // the agent gets its approval_id back and can start polling.
      console.error(
        "[agent_operator_approval_request] pause update failed",
        pauseErr
      );
    }

    await admin.channel(`operator_run:${ctx.runId}`).send({
      type: "broadcast",
      event: "approval_requested",
      payload: {
        approval_id: approval.id,
        run_id: ctx.runId,
        tool_call_id: body.tool_call_id,
        tool_name: body.tool_name,
        requested_args: body.requested_args,
        preview: body.preview ?? null,
        timeout_at: timeoutAt,
        sequence: eventRow.sequence,
        paused_at: pausedAt,
      },
    });

    return apiOk({ approval_id: approval.id });
  } catch (err) {
    console.error("[agent_operator_approval_request] failed", err);
    return E_INTERNAL();
  }
}
