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
import { sendMessage } from "@/server/services/run_messages_service";

/**
 * POST /api/agent/operator/steer
 *
 * Mid-run steering surface — a workspace member nudges an in-flight
 * Workspace Operator run ("wait, focus on X", "stop and summarize").
 * The Python agent polls `run_messages` between tool calls and picks
 * up the unread content at the next boundary.
 *
 * Auth: user cookie session. RLS on `workspace_operator_runs` and
 * `run_messages` keeps cross-workspace sends impossible.
 *
 * Only runs that are still alive (queued / planning / awaiting_approval
 * / executing) accept steers — terminal runs return 409
 * ("run_not_active") so the UI can stop offering the input.
 */

export const runtime = "nodejs";

interface SteerBody {
  run_id?: string;
  content?: string;
}

const STEERABLE_STATUSES = new Set([
  "queued",
  "planning",
  "awaiting_approval",
  "executing",
]);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return E_UNAUTHORIZED();
  }

  let body: SteerBody;
  try {
    body = (await request.json()) as SteerBody;
  } catch {
    return E_BAD_REQUEST("Invalid JSON body");
  }

  const runId = body.run_id;
  if (!runId || typeof runId !== "string") {
    return E_BAD_REQUEST("run_id is required");
  }
  if (typeof body.content !== "string") {
    return E_BAD_REQUEST("content is required");
  }
  const content = body.content.trim();
  if (content.length < 1 || content.length > 4000) {
    return E_BAD_REQUEST("content must be 1..4000 characters after trim");
  }

  try {
    const run = await getOperatorRun(supabase, runId);
    if (!run) return E_NOT_FOUND("run not found");

    if (!STEERABLE_STATUSES.has(run.status)) {
      return apiError(
        "run_not_active",
        "Cannot steer a terminal run",
        409
      );
    }

    const row = await sendMessage(supabase, {
      runId,
      workspaceId: run.workspace_id,
      senderUserId: user.id,
      content,
    });

    // Fan out on the per-run Realtime channel so the run-detail UI
    // renders the steer immediately rather than waiting for its own
    // refetch.
    const admin = createAdminClient();
    try {
      await admin.channel(`operator_run:${runId}`).send({
        type: "broadcast",
        event: "steer_queued",
        payload: {
          run_id: runId,
          message_id: row.id,
          content,
          sender_user_id: user.id,
          created_at: row.created_at,
        },
      });
    } catch (err) {
      console.error("[steer] broadcast failed", {
        run_id: runId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    return apiOk({
      message_id: row.id,
      queued_at: row.created_at,
    });
  } catch (err) {
    console.error("[steer] failed", {
      run_id: runId,
      user_id: user.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to queue steer message.");
  }
}
