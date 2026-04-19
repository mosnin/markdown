import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNoteForWorkspace } from "@/server/services/note_service";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

/**
 * POST /api/agent/tools/read_note
 *
 * Internal endpoint invoked by the Workspace Operator. Returns the
 * branch-overlay view of a single note: if the envelope includes a
 * branch_id and the branch has a head for this note, the returned
 * `content` reflects the branch's draft. Otherwise, main is returned.
 *
 * Body: { note_id: string }
 * Returns: { note_id, title, content, branch_id, version }
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
    return E_BAD_REQUEST("note_id is required and must be a non-empty string");
  }

  const admin = createAdminClient();

  try {
    const note = await getNoteForWorkspace(
      admin,
      note_id,
      ctx.workspaceId,
      ctx.branchId ?? null
    );
    if (!note) {
      return apiError(
        "note_not_found",
        "note_id not found in this workspace",
        404
      );
    }
    return apiOk({
      run_id: ctx.runId,
      note_id: note.id,
      title: note.title,
      content: note.markdown_content ?? "",
      branch_id: ctx.branchId ?? null,
      version: note.current_version_id ?? null,
    });
  } catch (err) {
    console.error("[agent_tools_read_note] failed", err);
    return E_INTERNAL();
  }
}
