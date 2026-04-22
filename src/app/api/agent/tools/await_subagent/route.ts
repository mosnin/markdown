/**
 * POST /api/agent/tools/await_subagent
 *
 * Internal endpoint. The orchestrator calls this to poll an in-flight
 * sub-agent invocation. Returns immediately if already done, otherwise
 * waits up to `timeout_ms` for completion.
 *
 * Body: { invocation_id: string, timeout_ms?: number }
 * Returns: { run_id, invocation_id, status, summary, error }
 */
import { type NextRequest } from "next/server";
import { apiOk, apiError, E_BAD_REQUEST } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSubagentInvocationById } from "@/server/repositories/subagent_invocation_repository";

const DEFAULT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

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

  let body: { invocation_id?: string; timeout_ms?: number };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const invocationId =
    typeof body.invocation_id === "string" ? body.invocation_id : "";
  if (!invocationId) return E_BAD_REQUEST("invocation_id is required");

  const timeoutMs =
    typeof body.timeout_ms === "number" && Number.isFinite(body.timeout_ms)
      ? Math.max(0, Math.min(300_000, body.timeout_ms))
      : DEFAULT_TIMEOUT_MS;

  const supabase = createAdminClient();

  const initial = await getSubagentInvocationById(supabase, invocationId);
  if (!initial) return apiError("not_found", "Invocation not found", 404);
  if (initial.workspace_id !== ctx.workspaceId) {
    return apiError("forbidden", "Invocation not in this workspace", 403);
  }

  if (
    initial.status === "completed" ||
    initial.status === "failed" ||
    initial.status === "cancelled"
  ) {
    return apiOk({
      run_id: ctx.runId,
      invocation_id: invocationId,
      status: initial.status,
      summary: initial.summary,
      error: initial.error,
    });
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const row = await getSubagentInvocationById(supabase, invocationId);
    if (!row) break;
    if (
      row.status === "completed" ||
      row.status === "failed" ||
      row.status === "cancelled"
    ) {
      return apiOk({
        run_id: ctx.runId,
        invocation_id: invocationId,
        status: row.status,
        summary: row.summary,
        error: row.error,
      });
    }
  }

  return apiOk({
    run_id: ctx.runId,
    invocation_id: invocationId,
    status: "running",
    summary: null,
    error: null,
  });
}
