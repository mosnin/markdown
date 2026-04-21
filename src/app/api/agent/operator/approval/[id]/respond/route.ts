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
import {
  getApprovalById,
  resolveApproval,
} from "@/server/services/tool_call_approvals_service";
import { recordEvent } from "@/server/services/operator_run_events_service";

/**
 * POST /api/agent/operator/approval/[id]/respond
 *
 * User-authenticated tool-call approval gate — the "yes / no / run with
 * these edits" button on the V3 agent harness UI. The Python agent parked
 * a row in `tool_call_approvals` and paused the run; this route flips the
 * row to approved / rejected, clears the run's paused flags, broadcasts
 * the decision on the per-run Realtime channel, and records a durable
 * event for replay.
 *
 * Auth: normal user cookie session. RLS on `tool_call_approvals` keeps
 * cross-workspace lookups returning null (surfaced here as 404).
 *
 * Idempotency: already-resolved approvals return 409 ("already_resolved")
 * so the UI can refetch and show the winning decision rather than blindly
 * overwriting it.
 */

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface RespondBody {
  decision?: "approve" | "reject";
  edited_args?: unknown;
  reject_reason?: string;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return E_UNAUTHORIZED();
  }

  const { id } = await params;
  if (!id) return E_NOT_FOUND("approval id required");

  let body: RespondBody;
  try {
    body = (await request.json()) as RespondBody;
  } catch {
    return E_BAD_REQUEST("Invalid JSON body");
  }

  if (body.decision !== "approve" && body.decision !== "reject") {
    return E_BAD_REQUEST("decision must be 'approve' or 'reject'");
  }

  try {
    const approval = await getApprovalById(supabase, id);
    if (!approval) return E_NOT_FOUND("approval not found");

    if (approval.status !== "pending") {
      return apiError(
        "already_resolved",
        `Approval is ${approval.status}`,
        409
      );
    }

    const nextStatus: "approved" | "rejected" =
      body.decision === "approve" ? "approved" : "rejected";

    const resolved = await resolveApproval(supabase, id, {
      status: nextStatus,
      resolvedArgs:
        body.edited_args !== undefined
          ? body.edited_args
          : approval.requested_args,
      resolvedBy: user.id,
      rejectReason: body.reject_reason ?? null,
    });

    // Clear the paused flag on the run. The approval row lives under RLS
    // the user can read, but the run's paused_* columns may be locked
    // down tighter — use the admin client and scope to the run_id we
    // already verified via the approval lookup (workspace ownership was
    // enforced by RLS when we loaded `approval` above).
    const admin = createAdminClient();
    const { error: runUpdateError } = await admin
      .from("workspace_operator_runs")
      .update({ paused_at: null, paused_reason: null })
      .eq("id", approval.run_id);
    if (runUpdateError) {
      console.error("[approval respond] failed to clear paused state", {
        run_id: approval.run_id,
        err: runUpdateError.message,
      });
      // Don't fail the request — the resolution is already durable. The
      // paused flag is advisory for the UI; the agent picks up the
      // decision from the approvals row.
    }

    // Record the durable lifecycle event (admin client — the
    // operator_run_events table has no INSERT policy for auth users).
    try {
      await recordEvent(admin, {
        runId: approval.run_id,
        workspaceId: approval.workspace_id,
        eventType:
          nextStatus === "approved"
            ? "tool_call_approval_granted"
            : "tool_call_approval_rejected",
        toolName: approval.tool_name,
        toolCallId: approval.tool_call_id,
        payload: {
          approval_id: approval.id,
          resolved_args: resolved.resolved_args,
          resolved_by: user.id,
          reject_reason: resolved.reject_reason,
        },
      });
    } catch (err) {
      console.error("[approval respond] failed to record event", {
        run_id: approval.run_id,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Fan out on the per-run Realtime channel so any watching UIs flip
    // immediately instead of waiting for a poll.
    try {
      await admin.channel(`operator_run:${approval.run_id}`).send({
        type: "broadcast",
        event:
          nextStatus === "approved"
            ? "tool_call_approval_granted"
            : "tool_call_approval_rejected",
        payload: {
          run_id: approval.run_id,
          approval_id: approval.id,
          tool_call_id: approval.tool_call_id,
          tool_name: approval.tool_name,
          resolved_args: resolved.resolved_args,
          resolved_by: user.id,
          reject_reason: resolved.reject_reason,
          resolved_at: resolved.resolved_at,
        },
      });
    } catch (err) {
      console.error("[approval respond] broadcast failed", {
        run_id: approval.run_id,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    return apiOk({
      status: resolved.status,
      resolved_at: resolved.resolved_at,
    });
  } catch (err) {
    console.error("[approval respond] failed", {
      approval_id: id,
      user_id: user.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to resolve approval.");
  }
}
