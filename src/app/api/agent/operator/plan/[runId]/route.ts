import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  apiOk,
  apiError,
  E_INTERNAL,
  E_UNAUTHORIZED,
  E_NOT_FOUND,
  E_BAD_REQUEST,
} from "@/lib/api/response";
import { getOperatorRun } from "@/server/services/workspace_operator_runs_service";
import {
  getRunPlan,
  updateRunPlan,
  type RunPlanStep,
} from "@/server/services/run_plans_service";

/**
 * GET/PUT /api/agent/operator/plan/[runId]
 *
 * Plan-document surface for the V3 agent harness.
 *
 * GET returns the current plan (may be null if the agent hasn't written
 * one yet). PUT lets a workspace member edit the `summary` / `steps`
 * before they approve — the agent picks the edited plan up on resume.
 *
 * Auth: user cookie session. RLS on `workspace_operator_runs` and
 * `run_plans` keeps cross-workspace access invisible.
 *
 * PUT is gated on the run status being `awaiting_approval` or
 * `planning` — we don't let late edits bleed into an execution that's
 * already in flight (409 "plan_locked").
 */

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

interface PutBody {
  summary?: string | null;
  steps?: RunPlanStep[];
}

const EDITABLE_STATUSES = new Set(["awaiting_approval", "planning"]);

export async function GET(_request: NextRequest, { params }: RouteParams) {
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

    const plan = await getRunPlan(supabase, runId);

    return apiOk({
      run_id: runId,
      plan,
    });
  } catch (err) {
    console.error("[plan GET] failed", {
      run_id: runId,
      user_id: user.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to load plan.");
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return E_UNAUTHORIZED();
  }

  const { runId } = await params;
  if (!runId) return E_NOT_FOUND("run id required");

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return E_BAD_REQUEST("Invalid JSON body");
  }

  if (body.summary === undefined && body.steps === undefined) {
    return E_BAD_REQUEST("at least one of summary or steps must be provided");
  }
  if (body.steps !== undefined && !Array.isArray(body.steps)) {
    return E_BAD_REQUEST("steps must be an array");
  }

  try {
    const run = await getOperatorRun(supabase, runId);
    if (!run) return E_NOT_FOUND("run not found");

    if (!EDITABLE_STATUSES.has(run.status)) {
      return apiError(
        "plan_locked",
        `Cannot edit plan once run is ${run.status}`,
        409
      );
    }

    const updated = await updateRunPlan(supabase, runId, {
      summary: body.summary,
      steps: body.steps,
    });

    // Fan out on the per-run Realtime channel so co-reviewers see the
    // edit without refetching.
    const admin = createAdminClient();
    try {
      await admin.channel(`operator_run:${runId}`).send({
        type: "broadcast",
        event: "plan_edited",
        payload: {
          run_id: runId,
          summary: updated.summary,
          steps: updated.steps,
          edited_by: user.id,
          updated_at: updated.updated_at,
        },
      });
    } catch (err) {
      console.error("[plan PUT] broadcast failed", {
        run_id: runId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    return apiOk({ plan: updated });
  } catch (err) {
    console.error("[plan PUT] failed", {
      run_id: runId,
      user_id: user.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to update plan.");
  }
}
