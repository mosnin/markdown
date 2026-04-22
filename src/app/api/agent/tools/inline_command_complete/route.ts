/**
 * POST /api/agent/tools/inline_command_complete
 *
 * Callback Modal calls when a built-in slash command (or the final leg of
 * a skill-backed command) terminates. Writes output + status back to
 * inline_command_invocations. Idempotent.
 *
 * Body: {
 *   invocation_id: string,
 *   status: "completed" | "failed" | "cancelled",
 *   output?: string,
 *   error?: string
 * }
 */
import { type NextRequest } from "next/server";
import { apiOk, apiError, E_BAD_REQUEST } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getInlineCommandInvocationById,
  updateInlineCommandInvocation,
} from "@/server/repositories/inline_command_repository";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

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
    output?: string;
    error?: string;
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
  if (!TERMINAL.has(status)) {
    return E_BAD_REQUEST(
      `status must be one of: ${Array.from(TERMINAL).join(", ")}`
    );
  }

  const supabase = createAdminClient();
  const existing = await getInlineCommandInvocationById(supabase, invocationId);
  if (!existing) return apiError("not_found", "Invocation not found", 404);
  if (existing.workspace_id !== ctx.workspaceId) {
    return apiError("forbidden", "Invocation not in this workspace", 403);
  }

  // Idempotent: if already terminal, accept and return the current row.
  if (existing.status !== "running") {
    return apiOk({
      run_id: ctx.runId,
      invocation_id: invocationId,
      status: existing.status,
    });
  }

  await updateInlineCommandInvocation(supabase, invocationId, {
    status: status as "completed" | "failed" | "cancelled",
    output: typeof body.output === "string" ? body.output : null,
    error: typeof body.error === "string" ? body.error : null,
    completed_at: new Date().toISOString(),
  });

  return apiOk({
    run_id: ctx.runId,
    invocation_id: invocationId,
    status,
  });
}
