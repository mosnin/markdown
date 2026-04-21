import { type NextRequest } from "next/server";
import { apiOk, apiError, E_INTERNAL } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listUnreadMessages,
  markMessagesConsumed,
} from "@/server/services/run_messages_service";
import { recordEvent } from "@/server/services/operator_run_events_service";

/**
 * POST /api/agent/operator/steer/poll
 *
 * The Python agent polls this endpoint between tool calls to pick up any
 * mid-run steering messages a workspace member has sent ("actually focus
 * on X first", "stop at the next boundary", etc). The batch is marked
 * consumed server-side before we return so the agent sees each message
 * exactly once — even if the transport retries.
 *
 * Body: (none)
 * Returns: { messages: [{ id, content, created_at, sender_user_id }] }
 */

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

  const admin = createAdminClient();

  try {
    const rows = await listUnreadMessages(admin, ctx.runId);

    if (rows.length > 0) {
      // Mark consumed first; if the event-recording step fails we'd rather
      // lose the timeline event than re-deliver the message.
      await markMessagesConsumed(
        admin,
        rows.map((r) => r.id)
      );

      // Best-effort: record a timeline event per message so the UI can
      // render "agent received your message" in order. If one insert
      // collides on sequence the service retries once; beyond that we
      // swallow so the caller still gets the messages back.
      for (const msg of rows) {
        try {
          await recordEvent(admin, {
            runId: ctx.runId,
            workspaceId: ctx.workspaceId,
            eventType: "steer_message_received",
            payload: {
              message_id: msg.id,
              sender_user_id: msg.sender_user_id,
              content: msg.content,
              created_at: msg.created_at,
            },
          });
        } catch (innerErr) {
          console.error(
            "[agent_operator_steer_poll] failed to record event for message",
            msg.id,
            innerErr
          );
        }
      }
    }

    return apiOk({
      messages: rows.map((r) => ({
        id: r.id,
        content: r.content,
        created_at: r.created_at,
        sender_user_id: r.sender_user_id,
      })),
    });
  } catch (err) {
    console.error("[agent_operator_steer_poll] failed", err);
    return E_INTERNAL();
  }
}
