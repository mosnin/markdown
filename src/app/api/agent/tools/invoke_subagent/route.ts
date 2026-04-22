/**
 * POST /api/agent/tools/invoke_subagent
 *
 * Internal endpoint. The orchestrator (Pog) calls this to delegate a focused
 * task to a sub-agent. We insert a subagent_invocations row, dispatch to the
 * Modal sub-agent endpoint, and return either the invocation id immediately
 * (wait=false) or block until completion (wait=true, capped at 120s).
 *
 * Body: {
 *   skill_id: string,
 *   task: string,
 *   wait?: boolean,
 *   timeout_ms?: number     // only meaningful when wait=true; default 120000
 * }
 * Returns: { run_id, invocation_id, status, summary?, error? }
 */
import { type NextRequest } from "next/server";
import { apiOk, apiError, E_BAD_REQUEST } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/api/rate_limit";
import {
  createSubagentInvocation,
  getSubagentInvocationById,
  updateSubagentInvocation,
} from "@/server/repositories/subagent_invocation_repository";
import {
  dispatchSubagentRun,
  resolveMaxTurns,
} from "@/server/services/subagent_dispatch_service";

// 10 invocations per minute per workspace — prevents runaway recursion.
const SUBAGENT_LIMIT_PER_MIN = 10;
const MAX_DEPTH = 2;
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
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

  let body: {
    skill_id?: string;
    task?: string;
    wait?: boolean;
    timeout_ms?: number;
    parent_invocation_id?: string;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const skillId = typeof body.skill_id === "string" ? body.skill_id.trim() : "";
  const task = typeof body.task === "string" ? body.task.trim() : "";
  if (!skillId) return E_BAD_REQUEST("skill_id is required");
  if (!task) return E_BAD_REQUEST("task is required");

  const wait = body.wait !== false; // default true
  const timeoutMs =
    typeof body.timeout_ms === "number" && Number.isFinite(body.timeout_ms)
      ? Math.max(1_000, Math.min(300_000, body.timeout_ms))
      : DEFAULT_WAIT_TIMEOUT_MS;

  // Rate limit — per workspace, 10/min.
  const rl = await checkRateLimit(
    `subagent:${ctx.workspaceId}`,
    SUBAGENT_LIMIT_PER_MIN,
    60
  );
  if (!rl.allowed) {
    return apiError(
      "rate_limited",
      `Sub-agent rate limit exceeded. Retry in ${rl.retryAfter}s.`,
      429
    );
  }

  const supabase = createAdminClient();

  // Resolve the skill + workspace scope + sub-agent enablement.
  const { data: skill, error: skillErr } = await supabase
    .from("skills")
    .select(
      "id, workspace_id, is_subagent, subagent_tools, subagent_max_turns"
    )
    .eq("id", skillId)
    .single();
  if (skillErr || !skill) {
    return apiError("not_found", "Skill not found", 404);
  }
  if (skill.workspace_id !== ctx.workspaceId) {
    return apiError("forbidden", "Skill is not in this workspace", 403);
  }
  if (!skill.is_subagent) {
    return apiError(
      "invalid_skill",
      "Skill is not enabled as a sub-agent. Toggle is_subagent=true in the skill editor.",
      400
    );
  }

  // Recursion depth: if parent_invocation_id is provided, compute depth.
  let depth = 1;
  if (typeof body.parent_invocation_id === "string") {
    const parent = await getSubagentInvocationById(
      supabase,
      body.parent_invocation_id
    );
    if (parent) depth = parent.depth + 1;
  }
  if (depth > MAX_DEPTH) {
    return apiError(
      "depth_exceeded",
      `Sub-agent recursion depth exceeded (max ${MAX_DEPTH})`,
      400
    );
  }

  // Insert the invocation row first — its id is the handle we pass to Modal.
  const invocation = await createSubagentInvocation(supabase, {
    workspace_id: ctx.workspaceId,
    parent_operator_run_id: null, // orchestrator run id is not a uuid on the envelope; Modal links via callback
    skill_id: skillId,
    user_id: ctx.userId,
    task,
    depth,
  });

  // Dispatch to Modal — non-blocking on the Modal side; we don't await the
  // full run. On dispatch failure mark the invocation failed and return.
  try {
    const dispatch = await dispatchSubagentRun({
      invocationId: invocation.id,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      skillId,
      task,
      allowedTools: (skill.subagent_tools as string[] | null) ?? null,
      maxTurns: resolveMaxTurns(skill.subagent_max_turns as number | null),
      depth,
      parentRunId: ctx.runId,
    });
    await updateSubagentInvocation(supabase, invocation.id, {
      status: "running",
      modal_run_id: dispatch.modalRunId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSubagentInvocation(supabase, invocation.id, {
      status: "failed",
      error: message,
      completed_at: new Date().toISOString(),
    });
    return apiError("dispatch_failed", message, 502);
  }

  if (!wait) {
    return apiOk({
      run_id: ctx.runId,
      invocation_id: invocation.id,
      status: "running",
    });
  }

  // Block until the invocation terminates or we hit the timeout.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await getSubagentInvocationById(supabase, invocation.id);
    if (!row) break;
    if (
      row.status === "completed" ||
      row.status === "failed" ||
      row.status === "cancelled"
    ) {
      return apiOk({
        run_id: ctx.runId,
        invocation_id: invocation.id,
        status: row.status,
        summary: row.summary,
        error: row.error,
      });
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  return apiOk({
    run_id: ctx.runId,
    invocation_id: invocation.id,
    status: "running",
    summary: null,
    error: null,
  });
}
