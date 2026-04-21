import { type NextRequest } from "next/server";
import { apiOk, apiError, E_INTERNAL } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getApprovalByToolCallId } from "@/server/services/tool_call_approvals_service";

/**
 * POST /api/agent/operator/approval/poll
 *
 * The Python agent polls this endpoint while it waits for a parked
 * tool-call approval to resolve. Returns the current status + any
 * user-edited args (on approve) or reject reason (on reject).
 *
 * Status values mirror the DB CHECK on tool_call_approvals.status:
 * pending | approved | rejected | timed_out. The agent typically polls
 * on a modest backoff (Realtime is the fast-path; this is the fallback).
 *
 * Body: { tool_call_id }
 */

interface Body {
  tool_call_id?: string;
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

  const admin = createAdminClient();

  try {
    const row = await getApprovalByToolCallId(admin, ctx.runId, body.tool_call_id);
    if (!row) {
      return apiError("not_found", "Approval not found for this tool call", 404);
    }

    return apiOk({
      status: row.status,
      resolved_args: row.resolved_args,
      reject_reason: row.reject_reason,
    });
  } catch (err) {
    console.error("[agent_operator_approval_poll] failed", err);
    return E_INTERNAL();
  }
}
