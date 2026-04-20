import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNoteById } from "@/server/repositories/note_repository";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

/**
 * POST /api/agent/tools/move_note
 *
 * Move a note to a different folder within the SAME box. Cross-box
 * moves are not permitted from an agent context in v1 — they touch
 * ownership and guide-note assignments that need firmer consent than
 * an agent can supply.
 *
 * This is a non-versioned metadata change — it writes the
 * `notes.folder_id` column directly (on main). Branch-aware folder
 * moves are a future refinement.
 *
 * Body: { note_id: string, folder_id: string | null }
 * Returns: { run_id, note_id, folder_id }
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

  let body: { note_id?: string; folder_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { note_id, folder_id } = body;
  if (typeof note_id !== "string" || !note_id.trim()) {
    return E_BAD_REQUEST("note_id is required");
  }
  if (
    folder_id !== null &&
    (typeof folder_id !== "string" || !folder_id.trim())
  ) {
    return E_BAD_REQUEST("folder_id must be a string or null");
  }

  const admin = createAdminClient();

  const note = await getNoteById(admin, note_id);
  if (!note) {
    return apiError("note_not_found", "note_id not found", 404);
  }
  // Verify workspace ownership via the box.
  const { data: box, error: boxErr } = await admin
    .from("boxes")
    .select("workspace_id")
    .eq("id", note.box_id)
    .maybeSingle();
  if (boxErr || !box || box.workspace_id !== ctx.workspaceId) {
    return apiError("note_not_found", "note_id not found in this workspace", 404);
  }

  // Target folder must live in the same box (if specified).
  if (folder_id) {
    const { data: folder, error: folderErr } = await admin
      .from("folders")
      .select("id, box_id")
      .eq("id", folder_id)
      .maybeSingle();
    if (folderErr || !folder || folder.box_id !== note.box_id) {
      return apiError(
        "folder_mismatch",
        "folder_id must belong to the same box as the note",
        400
      );
    }
  }

  const { error: updErr } = await admin
    .from("notes")
    .update({ folder_id: folder_id ?? null })
    .eq("id", note_id);
  if (updErr) {
    console.error("[agent_tools_move_note] update failed", updErr);
    return E_INTERNAL();
  }

  return apiOk({
    run_id: ctx.runId,
    note_id,
    folder_id: folder_id ?? null,
  });
}
