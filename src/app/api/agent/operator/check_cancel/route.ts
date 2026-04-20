import { type NextRequest } from "next/server";
import { apiOk, apiError, E_INTERNAL } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/agent/operator/check_cancel?run_id=...
 *
 * Internal endpoint polled by the Workspace Operator (Modal Python agent)
 * between phases — and periodically inside long-running execute — to ask
 * "should I bail?". The answer is `{ cancelled: <bool> }`, derived from
 * the `cancellation_requested_at` column on workspace_operator_runs.
 *
 * Auth: shared-secret + envelope, same as `/api/agent/tools/*`. Uses the
 * admin Supabase client because the caller is Modal, not a logged-in user;
 * we still scope the lookup by `workspace_id` from the envelope to keep
 * cross-workspace probes impossible.
 *
 * Why GET (not POST)? The poll is read-only and idempotent; using GET means
 * Modal can rely on standard HTTP-cache semantics if we ever want to put a
 * shared cache in front (we currently do not — the column is too hot).
 */
export async function GET(request: NextRequest) {
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

  const url = new URL(request.url);
  const runId = url.searchParams.get("run_id");
  if (!runId) {
    return apiError("bad_request", "run_id query parameter is required", 400);
  }

  const admin = createAdminClient();

  try {
    const { data, error } = await admin
      .from("workspace_operator_runs")
      .select("id, workspace_id, cancellation_requested_at, status")
      .eq("id", runId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      // Treat unknown runs as "not cancelled" rather than 404 — the operator
      // shouldn't crash mid-loop on a transient lookup miss; it'll just keep
      // running and the row will appear once the dispatcher persists it.
      return apiOk({ run_id: runId, cancelled: false });
    }

    return apiOk({
      run_id: runId,
      cancelled: data.cancellation_requested_at !== null,
    });
  } catch (err) {
    console.error("[agent_operator_check_cancel] failed", err);
    return E_INTERNAL();
  }
}
