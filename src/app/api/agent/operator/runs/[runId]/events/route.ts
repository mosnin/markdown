import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  apiOk,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_NOT_FOUND,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import { listEventsForRun } from "@/server/services/operator_run_events_service";
import { getOperatorRun } from "@/server/services/workspace_operator_runs_service";

/**
 * GET /api/agent/operator/runs/[runId]/events
 *
 * Replay / tail the durable event stream for an operator run. Returns
 * events ordered by `sequence` ASC, paged via `after_sequence` (exclusive
 * cursor) and `limit` (default 100, capped at 500).
 *
 * Visibility: we verify the run is readable by the session user via
 * `getOperatorRun` (RLS-scoped) and return 404 if it isn't — never 403,
 * so cross-workspace probes can't enumerate run ids.
 */

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
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

  const url = new URL(request.url);
  const afterSequenceRaw = url.searchParams.get("after_sequence");
  const limitRaw = url.searchParams.get("limit");

  let afterSequence = 0;
  if (afterSequenceRaw !== null) {
    const parsed = Number.parseInt(afterSequenceRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return E_BAD_REQUEST("after_sequence must be a non-negative integer.");
    }
    afterSequence = parsed;
  }

  let limit = 100;
  if (limitRaw !== null) {
    const parsed = Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return E_BAD_REQUEST("limit must be a positive integer.");
    }
    limit = Math.min(parsed, 500);
  }

  try {
    const run = await getOperatorRun(supabase, runId);
    if (!run) {
      return E_NOT_FOUND("run not found");
    }

    const result = await listEventsForRun(supabase, {
      runId,
      afterSequence,
      limit,
    });

    return apiOk({ events: result.rows, next_cursor: result.nextCursor });
  } catch (err) {
    console.error("[agent operator run events GET] failed", {
      run_id: runId,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to list operator run events.");
  }
}
