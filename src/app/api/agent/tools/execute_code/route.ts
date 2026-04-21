import { type NextRequest } from "next/server";
import { apiOk, apiError, E_INTERNAL } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordCodeExecution } from "@/server/services/agent_code_executions_service";

/**
 * POST /api/agent/tools/execute_code
 *
 * Audit-only endpoint. The Workspace Operator agent runs user code
 * inside a fresh `modal.Sandbox` spawned from the agent process itself
 * (see `agent/src/workspace_operator/sandbox.py`), then POSTs the
 * captured result here so the row lands in `agent_code_executions`
 * and the UI / timeline can render it.
 *
 * Body: {
 *   language: "python"|"javascript",
 *   code,
 *   stdout, stderr,
 *   return_value,
 *   exit_code, elapsed_ms,
 *   truncated, error
 * }
 *
 * Response shape matches the pre-sandbox stub so the agent's
 * deserialization is unchanged:
 *   { stdout, stderr, return_value, exit_code, elapsed_ms, execution_id }
 */

interface Body {
  language?: string;
  code?: string;
  stdout?: unknown;
  stderr?: unknown;
  return_value?: unknown;
  exit_code?: unknown;
  elapsed_ms?: unknown;
  truncated?: unknown;
  error?: unknown;
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

  if (typeof body.stdout !== "string") {
    return apiError("bad_request", "stdout must be a string", 400);
  }
  if (typeof body.stderr !== "string") {
    return apiError("bad_request", "stderr must be a string", 400);
  }
  const stdout = body.stdout;
  const stderr = body.stderr;

  if (typeof body.exit_code !== "number" || !Number.isFinite(body.exit_code)) {
    return apiError("bad_request", "exit_code must be a number", 400);
  }
  const exitCode = body.exit_code;

  if (
    typeof body.elapsed_ms !== "number" ||
    !Number.isFinite(body.elapsed_ms) ||
    body.elapsed_ms < 0
  ) {
    return apiError(
      "bad_request",
      "elapsed_ms must be a non-negative number",
      400
    );
  }
  const elapsedMs = body.elapsed_ms;

  const truncated = body.truncated === true;
  const error =
    typeof body.error === "string" && body.error.length > 0 ? body.error : null;

  let returnValue: string | null = null;
  if (body.return_value !== null && body.return_value !== undefined) {
    returnValue =
      typeof body.return_value === "string"
        ? body.return_value
        : JSON.stringify(body.return_value);
  }

  const admin = createAdminClient();

  try {
    const row = await recordCodeExecution(admin, {
      runId: ctx.runId,
      workspaceId: ctx.workspaceId,
      language,
      code,
      stdout,
      stderr,
      returnValue,
      exitCode,
      elapsedMs,
      truncated,
      error,
    });

    return apiOk({
      stdout,
      stderr,
      return_value: returnValue,
      exit_code: exitCode,
      elapsed_ms: elapsedMs,
      execution_id: row.id,
    });
  } catch (err) {
    console.error("[agent_tools_execute_code] failed", err);
    return E_INTERNAL();
  }
}
