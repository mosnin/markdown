/**
 * POST /api/agent/tools/subagent_complete
 *
 * Callback endpoint invoked by the Modal sub-agent runtime when a run
 * terminates. Writes the final status + summary to subagent_invocations.
 *
 * Not called by the orchestrator — this is a Modal → Next.js webhook-style
 * endpoint using the same shared-secret auth.
 *
 * Body: {
 *   invocation_id: string,
 *   status: "completed" | "failed" | "cancelled",
 *   summary?: string,
 *   error?: string,
 *   tool_calls_count?: number,
 *   input_tokens?: number,
 *   output_tokens?: number
 * }
 */
import { type NextRequest } from "next/server";
import { apiOk, apiError, E_BAD_REQUEST } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSubagentInvocationById,
  updateSubagentInvocation,
} from "@/server/repositories/subagent_invocation_repository";

const ALLOWED_TERMINAL = new Set(["completed", "failed", "cancelled"]);

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
    invocation_id?: string;
    status?: string;
    summary?: string;
    error?: string;
    tool_calls_count?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const invocationId =
    typeof body.invocation_id === "string" ? body.invocation_id : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!invocationId) return E_BAD_REQUEST("invocation_id is required");
  if (!ALLOWED_TERMINAL.has(status)) {
    return E_BAD_REQUEST(
      `status must be one of: ${Array.from(ALLOWED_TERMINAL).join(", ")}`
    );
  }

  const supabase = createAdminClient();
  const existing = await getSubagentInvocationById(supabase, invocationId);
  if (!existing) return apiError("not_found", "Invocation not found", 404);
  if (existing.workspace_id !== ctx.workspaceId) {
    return apiError("forbidden", "Invocation not in this workspace", 403);
  }

  await updateSubagentInvocation(supabase, invocationId, {
    status: status as "completed" | "failed" | "cancelled",
    summary: typeof body.summary === "string" ? body.summary : null,
    error: typeof body.error === "string" ? body.error : null,
    completed_at: new Date().toISOString(),
    tool_calls_count:
      typeof body.tool_calls_count === "number" &&
      Number.isFinite(body.tool_calls_count)
        ? Math.max(0, Math.floor(body.tool_calls_count))
        : undefined,
    input_tokens:
      typeof body.input_tokens === "number" && Number.isFinite(body.input_tokens)
        ? Math.max(0, Math.floor(body.input_tokens))
        : undefined,
    output_tokens:
      typeof body.output_tokens === "number" &&
      Number.isFinite(body.output_tokens)
        ? Math.max(0, Math.floor(body.output_tokens))
        : undefined,
  });

  return apiOk({ run_id: ctx.runId, invocation_id: invocationId, status });
}
