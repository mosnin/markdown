import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  apiOk,
  E_INTERNAL,
  E_NOT_FOUND,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import { listPendingForRun } from "@/server/services/tool_call_approvals_service";
import { getOperatorRun } from "@/server/services/workspace_operator_runs_service";

/**
 * GET /api/agent/operator/runs/[runId]/approvals
 *
 * List pending tool-call approvals for a single run — the queue shown
 * on the run detail page. Visibility is verified through
 * `getOperatorRun`, which is RLS-scoped; unknown / cross-workspace runs
 * surface as 404.
 */

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return E_UNAUTHORIZED("Valid session required.");
  }

  const { runId } = await params;
  if (!runId || !UUID_RE.test(runId)) {
    return E_NOT_FOUND("run not found");
  }

  try {
    const run = await getOperatorRun(supabase, runId);
    if (!run) {
      return E_NOT_FOUND("run not found");
    }

    const approvals = await listPendingForRun(supabase, runId);
    return apiOk({ approvals });
  } catch (err) {
    console.error("[agent operator run approvals GET] failed", {
      run_id: runId,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to list pending approvals.");
  }
}
