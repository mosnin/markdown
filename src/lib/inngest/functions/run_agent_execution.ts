/**
 * Shared trigger execution path.
 *
 * All three Inngest functions (manual / note / scheduled) funnel here.
 *
 * Responsibilities:
 *   1. Application-level idempotency guard — skip if a run for this
 *      trigger has been in `running` status for less than 5 minutes.
 *      This is the third layer of idempotency (see docs/automation_v1.md
 *      — Inngest function-level dedup is layer 1, the `agent_trigger_runs`
 *      row itself is layer 2).
 *   2. Create an `agent_trigger_runs` row with status='running'.
 *   3. Load the agent + build the dispatch prompt from its system_prompt.
 *   4. Call `dispatchOperatorRun` and link the operator run id we gave it.
 *   5. Close the row with status='completed' / 'failed' / 'skipped'.
 *
 * Inngest wraps this in its automatic retry policy at the step level, so
 * this code never retries on its own — a thrown error is the correct way
 * to surface a retry-eligible failure up to Inngest.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createTriggerRun,
  findRecentRunningRun,
  updateTriggerRun,
} from "@/server/repositories/agent_trigger_run_repository";
import { dispatchOperatorRun } from "@/server/services/workspace_operator_service";

export interface RunAgentExecutionParams {
  triggerId: string;
  /** Optional event-specific context appended to the agent prompt. */
  contextSuffix?: string;
}

export interface RunAgentExecutionResult {
  status: "completed" | "failed" | "skipped";
  runId: string | null;
  operatorRunId: string | null;
  error?: string;
  skipReason?: string;
}

export async function runAgentExecution(
  params: RunAgentExecutionParams
): Promise<RunAgentExecutionResult> {
  const admin: SupabaseClient = createAdminClient();

  // ── 1. Load the trigger + agent ──────────────────────────────────────
  const { data: trigger, error: triggerErr } = await admin
    .from("agent_triggers")
    .select("id, workspace_id, agent_id, trigger_type, label, is_enabled")
    .eq("id", params.triggerId)
    .maybeSingle();
  if (triggerErr || !trigger) {
    return {
      status: "failed",
      runId: null,
      operatorRunId: null,
      error: "Trigger not found",
    };
  }
  if (!trigger.is_enabled) {
    return {
      status: "skipped",
      runId: null,
      operatorRunId: null,
      skipReason: "Trigger disabled",
    };
  }

  const { data: agent, error: agentErr } = await admin
    .from("agents")
    .select("id, name, system_prompt, source_content, workspace_id")
    .eq("id", trigger.agent_id)
    .maybeSingle();
  if (agentErr || !agent) {
    return {
      status: "failed",
      runId: null,
      operatorRunId: null,
      error: "Agent not found",
    };
  }

  // ── 2. App-layer idempotency guard ───────────────────────────────────
  // If a run is already in flight for this trigger, record a `skipped`
  // row for visibility and exit.
  const inFlight = await findRecentRunningRun(admin, trigger.id, 5 * 60 * 1000);
  if (inFlight) {
    const skipped = await createTriggerRun(admin, {
      workspace_id: trigger.workspace_id,
      trigger_id: trigger.id,
      agent_id: trigger.agent_id,
    });
    await updateTriggerRun(admin, skipped.id, {
      status: "skipped",
      skip_reason: "Previous run still in progress",
      completed_at: new Date().toISOString(),
    });
    return {
      status: "skipped",
      runId: skipped.id,
      operatorRunId: null,
      skipReason: "Previous run still in progress",
    };
  }

  // ── 3. Create the run row ───────────────────────────────────────────
  const run = await createTriggerRun(admin, {
    workspace_id: trigger.workspace_id,
    trigger_id: trigger.id,
    agent_id: trigger.agent_id,
  });

  try {
    // ── 4. Build the dispatch prompt ───────────────────────────────────
    const baseInstructions =
      agent.system_prompt?.trim() ||
      agent.source_content?.trim() ||
      `You are the agent "${agent.name}". Execute your role.`;

    const promptParts = [baseInstructions];
    if (params.contextSuffix) {
      promptParts.push(`\n\n## Trigger context\n${params.contextSuffix}`);
    }
    const prompt = promptParts.join("\n");

    // ── 5. Resolve a home box for the run ──────────────────────────────
    // Triggers don't currently pin a box at the dispatch layer (only at
    // the event-filter layer). Fall back to the workspace's first active
    // box so the operator has somewhere to anchor note creation.
    const { data: box } = await admin
      .from("boxes")
      .select("id")
      .eq("workspace_id", trigger.workspace_id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!box) {
      throw new Error(
        "No active box in workspace to anchor the operator run"
      );
    }

    // ── 6. Dispatch ────────────────────────────────────────────────────
    // `dispatchOperatorRun` expects the caller to mint the run id. We
    // pass it through and stash it on the trigger run row so users can
    // cross-reference from the trigger history to the operator run.
    const operatorRunId = crypto.randomUUID();
    const dispatchResult = await dispatchOperatorRun({
      runId: operatorRunId,
      // Triggers are system-initiated: no human user. We pass the
      // workspace id as the actor header so the Modal side has a
      // non-empty value — auditing uses the `agent_trigger_runs` row
      // for ground truth, not this header.
      userId: trigger.workspace_id,
      workspaceId: trigger.workspace_id,
      // Main-branch runs only — branches are a user-driven concept.
      branchId: "",
      boxId: box.id,
      prompt,
    });

    // dispatchOperatorRun echoes back the run id we gave it. Prefer the
    // echoed value if present; fall back to the one we generated.
    const linkedOperatorRunId = dispatchResult.run_id ?? operatorRunId;

    // ── 7. Mark success ────────────────────────────────────────────────
    // A "failed" OperatorRunResult status still counts as a completed
    // *dispatch* from our perspective — the Modal side ran to completion
    // and reported back. The granular status lives on the
    // workspace_operator_runs row we linked to.
    const finalStatus: "completed" | "failed" =
      dispatchResult.status === "completed" ? "completed" : "failed";

    await updateTriggerRun(admin, run.id, {
      status: finalStatus,
      completed_at: new Date().toISOString(),
      workspace_operator_run_id: linkedOperatorRunId,
      ...(finalStatus === "failed"
        ? { error: dispatchResult.error ?? "Operator reported failure" }
        : {}),
    });

    return {
      status: finalStatus,
      runId: run.id,
      operatorRunId: linkedOperatorRunId,
      ...(finalStatus === "failed"
        ? { error: dispatchResult.error ?? "Operator reported failure" }
        : {}),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await updateTriggerRun(admin, run.id, {
      status: "failed",
      error: errorMsg,
      completed_at: new Date().toISOString(),
    });
    return {
      status: "failed",
      runId: run.id,
      operatorRunId: null,
      error: errorMsg,
    };
  }
}
