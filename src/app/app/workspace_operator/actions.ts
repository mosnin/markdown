"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import { createDraftBranch } from "@/server/services/branch_service";
import {
  dispatchOperatorRun,
  dispatchOperatorPlan,
  dispatchOperatorExecute,
  type OperatorRunResult,
  type OperatorPlanResult,
} from "@/server/services/workspace_operator_service";
import type { OperatorPlanStep } from "./types";
import { isWorkspaceOperatorEnabled } from "@/lib/env";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface RunWorkspaceOperatorInput {
  prompt: string;
  /** Box the agent may draft notes into. Required in v1. */
  boxId: string;
  /** Optional human-friendly branch name. Defaults to an agent-slug. */
  branchName?: string;
}

export interface RunWorkspaceOperatorOutput {
  run_id: string;
  branch_id: string;
  status: OperatorRunResult["status"];
  notes_created: string[];
  tool_calls: number;
  error?: string | null;
}

/**
 * Kick off a Workspace Operator run.
 *
 * Phase 1 flow:
 *   1. Auth + feature flag check
 *   2. Create a fresh draft branch scoped to the current user
 *   3. POST to the Modal endpoint with a signed envelope
 *   4. Record an audit event on completion
 *   5. Return the run result (note IDs created on the branch, tool calls)
 *
 * UI then navigates the user to the diff view for the branch.
 */
export async function runWorkspaceOperatorAction(
  input: RunWorkspaceOperatorInput
): Promise<ActionResult<RunWorkspaceOperatorOutput>> {
  try {
    if (!isWorkspaceOperatorEnabled()) {
      return {
        ok: false,
        error: "Workspace Operator is not enabled for this deployment.",
      };
    }

    const prompt = input.prompt?.trim();
    if (!prompt) {
      return { ok: false, error: "Prompt is required." };
    }
    if (prompt.length > 4000) {
      return { ok: false, error: "Prompt must be 4000 characters or fewer." };
    }
    if (!input.boxId?.trim()) {
      return { ok: false, error: "boxId is required." };
    }

    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();

    // Verify the target box belongs to this workspace — the agent layer
    // re-verifies, but we fail fast here with a clean error before we spend
    // money on a Modal invocation.
    const { data: box } = await supabase
      .from("boxes")
      .select("id, workspace_id")
      .eq("id", input.boxId)
      .maybeSingle();
    if (!box || box.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Target box not found in this workspace." };
    }

    const runId = randomUUID();
    const branchName = (input.branchName ?? `agent/${runId.slice(0, 8)}`).slice(0, 200);

    const branch = await createDraftBranch(supabase, {
      workspace_id: ctx.workspace.id,
      name: branchName,
      description: `Workspace Operator run ${runId}: ${prompt.slice(0, 200)}`,
      created_by: ctx.user.id,
    });

    let result: OperatorRunResult;
    try {
      result = await dispatchOperatorRun({
        runId,
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        branchId: branch.id,
        boxId: input.boxId,
        prompt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Audit the dispatch failure so the branch doesn't look like a mystery.
      await safeAudit(supabase, {
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        branchId: branch.id,
        runId,
        eventType: "workspace_operator.dispatch_failed",
        metadata: { error: message, prompt: prompt.slice(0, 200) },
      });
      return { ok: false, error: `Operator dispatch failed: ${message}` };
    }

    await safeAudit(supabase, {
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      branchId: branch.id,
      runId,
      eventType:
        result.status === "completed"
          ? "workspace_operator.run_completed"
          : "workspace_operator.run_failed",
      metadata: {
        notes_created: result.notes_created.length,
        tool_calls: result.tool_calls,
        error: result.error ?? null,
      },
    });

    return {
      ok: true,
      data: {
        run_id: runId,
        branch_id: branch.id,
        status: result.status,
        notes_created: result.notes_created,
        tool_calls: result.tool_calls,
        error: result.error ?? null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to run Workspace Operator.",
    };
  }
}

// ---------------------------------------------------------------------------
// Phase 2: plan → approve → execute flow
// ---------------------------------------------------------------------------

export interface RequestPlanInput {
  prompt: string;
  boxId: string;
  branchName?: string;
}

export interface RequestPlanOutput {
  run_id: string;
  branch_id: string;
  steps: OperatorPlanStep[];
  summary: string;
}

/**
 * Request a plan from the Workspace Operator without executing it.
 *
 * Phase 2 flow — step 1:
 *   1. Auth + feature flag check
 *   2. Create a fresh draft branch scoped to the current user
 *   3. POST to the Modal endpoint in "plan" mode
 *   4. Record an audit event for plan generation
 *   5. Return the plan steps (each marked "pending") to the UI
 */
export async function requestOperatorPlanAction(
  input: RequestPlanInput
): Promise<ActionResult<RequestPlanOutput>> {
  try {
    if (!isWorkspaceOperatorEnabled()) {
      return { ok: false, error: "Workspace Operator is not enabled." };
    }

    const prompt = input.prompt?.trim();
    if (!prompt) return { ok: false, error: "Prompt is required." };
    if (prompt.length > 4000)
      return { ok: false, error: "Prompt must be 4000 characters or fewer." };
    if (!input.boxId?.trim())
      return { ok: false, error: "boxId is required." };

    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();

    const { data: box } = await supabase
      .from("boxes")
      .select("id, workspace_id")
      .eq("id", input.boxId)
      .maybeSingle();
    if (!box || box.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Target box not found in this workspace." };
    }

    const runId = randomUUID();
    const branchName = (input.branchName ?? `agent/${runId.slice(0, 8)}`).slice(
      0,
      200
    );

    const branch = await createDraftBranch(supabase, {
      workspace_id: ctx.workspace.id,
      name: branchName,
      description: `Workspace Operator plan ${runId}: ${prompt.slice(0, 200)}`,
      created_by: ctx.user.id,
    });

    const plan = await dispatchOperatorPlan({
      runId,
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      branchId: branch.id,
      boxId: input.boxId,
      prompt,
    });

    await safeAudit(supabase, {
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      branchId: branch.id,
      runId,
      eventType: "workspace_operator.plan_generated",
      metadata: {
        steps: plan.steps.length,
        summary: plan.summary.slice(0, 200),
      },
    });

    return {
      ok: true,
      data: {
        run_id: runId,
        branch_id: branch.id,
        steps: plan.steps.map((s) => ({
          ...s,
          status: "pending" as const,
        })),
        summary: plan.summary,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to generate plan.",
    };
  }
}

export interface ApproveAndExecuteInput {
  runId: string;
  branchId: string;
  boxId: string;
  prompt: string;
  steps: Array<{ index: number; description: string; tool: string }>;
}

export interface ApproveAndExecuteOutput {
  run_id: string;
  branch_id: string;
  status: OperatorRunResult["status"];
  notes_created: string[];
  tool_calls: number;
  error?: string | null;
}

/**
 * Approve a previously generated plan and execute it.
 *
 * Phase 2 flow — step 2:
 *   1. Auth + feature flag check
 *   2. POST to the Modal endpoint in "execute" mode with the approved plan
 *   3. Modal calls back with progress events via /api/agent/tools/progress
 *   4. Record an audit event on completion or failure
 *   5. Return the final run result to the UI
 */
export async function approveAndExecuteAction(
  input: ApproveAndExecuteInput
): Promise<ActionResult<ApproveAndExecuteOutput>> {
  try {
    if (!isWorkspaceOperatorEnabled()) {
      return { ok: false, error: "Workspace Operator is not enabled." };
    }

    if (!input.runId || !input.branchId || !input.boxId) {
      return { ok: false, error: "runId, branchId, and boxId are required." };
    }
    if (!input.steps?.length) {
      return { ok: false, error: "At least one plan step is required." };
    }

    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();

    let result: OperatorRunResult;
    try {
      result = await dispatchOperatorExecute({
        runId: input.runId,
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        branchId: input.branchId,
        boxId: input.boxId,
        prompt: input.prompt,
        approvedPlan: input.steps,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await safeAudit(supabase, {
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        branchId: input.branchId,
        runId: input.runId,
        eventType: "workspace_operator.execute_failed",
        metadata: { error: message },
      });
      return { ok: false, error: `Operator execution failed: ${message}` };
    }

    await safeAudit(supabase, {
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      branchId: input.branchId,
      runId: input.runId,
      eventType:
        result.status === "completed"
          ? "workspace_operator.run_completed"
          : "workspace_operator.run_failed",
      metadata: {
        notes_created: result.notes_created.length,
        tool_calls: result.tool_calls,
        error: result.error ?? null,
      },
    });

    return {
      ok: true,
      data: {
        run_id: input.runId,
        branch_id: input.branchId,
        status: result.status,
        notes_created: result.notes_created,
        tool_calls: result.tool_calls,
        error: result.error ?? null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to execute plan.",
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function safeAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    workspaceId: string;
    actorId: string;
    branchId: string;
    runId: string;
    eventType: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await createAuditEvent(supabase, {
      workspace_id: params.workspaceId,
      actor_type: "user",
      actor_id: params.actorId,
      object_type: "draft_branch",
      object_id: params.branchId,
      event_type: params.eventType,
      metadata: { run_id: params.runId, ...params.metadata },
    });
  } catch (err) {
    console.error("[workspace_operator] audit write failed", err);
  }
}

