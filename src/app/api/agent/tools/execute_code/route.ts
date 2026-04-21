import { type NextRequest } from "next/server";
import { apiOk, apiError, E_INTERNAL } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordCodeExecution } from "@/server/services/agent_code_executions_service";

/**
 * POST /api/agent/tools/execute_code
 *
 * STUB: the real implementation runs user code in a sandboxed Modal
 * container. That runner isn't wired into this deploy yet — but the UI
 * and the agent both expect the tool to exist, and the audit / timeline
 * flow needs rows in `agent_code_executions` to render properly.
 *
 * For now we:
 *   - validate the language + code length up front,
 *   - persist a row with a clear "sandbox unavailable" stderr so the UI
 *     can render a visibly-degraded but not-broken result,
 *   - return a structured response with exit_code = -1 so the agent can
 *     detect the stub and not try to use the (nonexistent) output.
 *
 * Replace the body of this handler with a real dispatch to the sandbox
 * when it lands; the contract with the caller doesn't need to change.
 *
 * Body: { language: "python"|"javascript", code, timeout_seconds? }
 */

const STUB_STDERR = "execute_code sandbox not yet implemented in this deploy";

interface Body {
  language?: string;
  code?: string;
  timeout_seconds?: number;
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

  const language = body.language;
  if (language !== "python" && language !== "javascript") {
    return apiError(
      "bad_request",
      "language must be one of: python, javascript",
      400
    );
  }
  const code = body.code;
  if (typeof code !== "string" || code.length < 1) {
    return apiError("bad_request", "code is required", 400);
  }
  if (code.length > 20000) {
    return apiError(
      "bad_request",
      "code must be 20000 characters or fewer",
      400
    );
  }

  const admin = createAdminClient();

  try {
    const row = await recordCodeExecution(admin, {
      runId: ctx.runId,
      workspaceId: ctx.workspaceId,
      language,
      code,
      stdout: "",
      stderr: STUB_STDERR,
      returnValue: null,
      exitCode: -1,
      elapsedMs: 0,
      truncated: false,
      error: null,
    });

    return apiOk({
      stdout: "",
      stderr: "sandbox unavailable",
      return_value: null,
      exit_code: -1,
      elapsed_ms: 0,
      execution_id: row.id,
    });
  } catch (err) {
    console.error("[agent_tools_execute_code] failed", err);
    return E_INTERNAL();
  }
}
