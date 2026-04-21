import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  apiOk,
  apiError,
  E_INTERNAL,
  E_UNAUTHORIZED,
  E_NOT_FOUND,
} from "@/lib/api/response";
import {
  getOperatorRun,
  updateOperatorRun,
} from "@/server/services/workspace_operator_runs_service";
import { getRunPlan, updateRunPlan } from "@/server/services/run_plans_service";
import { recordEvent } from "@/server/services/operator_run_events_service";
import { dispatchOperatorExecute } from "@/server/services/workspace_operator_service";

/**
 * POST /api/agent/operator/plan/[runId]/approve
 *
 * Final gate in the plan-first flow: a workspace member approves the
 * (possibly-edited) plan, the run status flips to `executing`, and we
 * fire the Modal execute dispatch with the approved steps.
 *
 * Auth: user cookie session. RLS on `workspace_operator_runs` /
 * `run_plans` keeps cross-workspace approvals invisible.
 *
 * The Modal dispatch is fire-and-forget — a failure to reach Modal is
 * logged but does not fail the HTTP response, because the UI can poll
 * and re-drive. The run is already flipped to `executing` before the
 * dispatch so the UI reflects the approval state immediately.
 */

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return E_UNAUTHORIZED();
  }

  const { runId } = await params;
  if (!runId) return E_NOT_FOUND("run id required");

  try {
    const run = await getOperatorRun(supabase, runId);
    if (!run) return E_NOT_FOUND("run not found");

    if (run.status !== "awaiting_approval") {
      return apiError(
        "not_awaiting_approval",
        `Run status is ${run.status}; expected awaiting_approval`,
        409
      );
    }

    const plan = await getRunPlan(supabase, runId);
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      return apiError("no_plan", "Run has no plan to approve", 409);
    }

    const updatedPlan = await updateRunPlan(supabase, runId, {
      approved: true,
      approvedBy: user.id,
    });

    const admin = createAdminClient();

    try {
      await recordEvent(admin, {
        runId,
        workspaceId: run.workspace_id,
        eventType: "plan_approved",
        payload: {
          approved_by: user.id,
          summary: updatedPlan.summary,
          step_count: updatedPlan.steps.length,
        },
      });
    } catch (err) {
      console.error("[plan approve] failed to record event", {
        run_id: runId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await admin.channel(`operator_run:${runId}`).send({
        type: "broadcast",
        event: "plan_approved",
        payload: {
          run_id: runId,
          approved_by: user.id,
          approved_at: updatedPlan.approved_at,
        },
      });
    } catch (err) {
      console.error("[plan approve] broadcast failed", {
        run_id: runId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    await updateOperatorRun(supabase, runId, { status: "executing" });

    // Normalize steps for Modal — the execute dispatcher expects
    // { index, description, tool } with a non-null tool string. Drop
    // any step whose tool is null (e.g. a narrative "prepare" step)
    // or coerce to empty string; we choose to filter to keep the
    // agent-facing shape clean, falling back to an empty array only
    // if literally everything was null.
    const approvedPlan = updatedPlan.steps
      .filter((s): s is typeof s & { tool: string } => typeof s.tool === "string" && s.tool.length > 0)
      .map((s) => ({
        index: s.index,
        description: s.description,
        tool: s.tool,
      }));

    // Fire-and-forget — don't await, but catch rejections so the
    // Node process doesn't log an unhandledRejection. The UI polls
    // run status + events, so a late-arriving failure surfaces there.
    void dispatchOperatorExecute({
      runId,
      userId: user.id,
      workspaceId: run.workspace_id,
      branchId: run.branch_id ?? "",
      boxId: "",
      prompt: run.prompt,
      approvedPlan,
      model: run.model,
      maxInputTokens: run.max_input_tokens,
      maxOutputTokens: run.max_output_tokens,
    }).catch((err) => {
      console.error("[plan approve] dispatchOperatorExecute failed", {
        run_id: runId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    return apiOk({
      dispatched: true,
      run_status: "executing" as const,
    });
  } catch (err) {
    console.error("[plan approve] failed", {
      run_id: runId,
      user_id: user.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to approve plan.");
  }
}
