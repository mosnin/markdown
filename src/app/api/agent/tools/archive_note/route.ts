import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { archiveNote } from "@/server/services/lifecycle_service";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

/**
 * POST /api/agent/tools/archive_note
 *
 * Archive a note. The lifecycle service enforces the invariants that
 * matter: you can't archive the current guide note, you can't archive
 * a trashed note, and the note must belong to the envelope's workspace.
 *
 * Archive is reversible (`restoreNote`), so it's the curator-tool of
 * choice over `trashNote` for the agent — we keep destructive delete
 * out of reach until we have stronger ambient consent signals.
 *
 * Body: { note_id: string }
 * Returns: { run_id, note_id, status }
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
        return E_BAD_REQUEST(`Missing required header: ${auth.failure.field}`);
      case "invalid_envelope":
        return E_BAD_REQUEST(
          `Invalid ${auth.failure.field}: ${auth.failure.reason}`
        );
    }
  }
  const { ctx } = auth;

  let body: { note_id?: string };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { note_id } = body;
  if (typeof note_id !== "string" || !note_id.trim()) {
    return E_BAD_REQUEST("note_id is required");
  }

  const admin = createAdminClient();

  try {
    const updated = await archiveNote(admin, ctx.userId, ctx.workspaceId, note_id);
    return apiOk({
      run_id: ctx.runId,
      note_id: updated.id,
      status: updated.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      return apiError("note_not_found", message, 404);
    }
    if (
      message.includes("guide note") ||
      message.includes("already archived") ||
      message.includes("trashed")
    ) {
      return apiError("archive_rejected", message, 409);
    }
    console.error("[agent_tools_archive_note] failed", err);
    return E_INTERNAL();
  }
}
