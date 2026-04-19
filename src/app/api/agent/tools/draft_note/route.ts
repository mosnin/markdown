import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNoteOnBranch } from "@/server/services/note_service";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_FORBIDDEN,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

/**
 * POST /api/agent/tools/draft_note
 *
 * Internal endpoint invoked by the Workspace Operator. Creates a new note on
 * the envelope's branch (branch_id must be present; the Operator never writes
 * to main directly in v1). Reuses the existing `createNoteOnBranch` service
 * which enforces branch-scoped versioning and fires `note.branch_created`
 * audit events.
 *
 * Body:
 *   - box_id: string (required)    — box to place the note in
 *   - title: string (required)
 *   - markdown_content: string     — body of the note (agent output)
 *   - summary?: string | null
 *   - tags?: string[]
 *   - folder_id?: string | null
 *
 * Returns: { note_id, title, branch_id }
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

  if (!ctx.branchId) {
    return E_FORBIDDEN(
      "Workspace Operator writes require a branch_id envelope header — the agent cannot write to main"
    );
  }

  let body: {
    box_id?: string;
    title?: string;
    markdown_content?: string;
    summary?: string | null;
    tags?: string[];
    folder_id?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { box_id, title, markdown_content, summary, tags, folder_id } = body;
  if (typeof box_id !== "string" || !box_id.trim()) {
    return E_BAD_REQUEST("box_id is required");
  }
  if (typeof title !== "string" || !title.trim()) {
    return E_BAD_REQUEST("title is required and must be a non-empty string");
  }
  if (title.length > 500) {
    return E_BAD_REQUEST("title must be 500 characters or fewer");
  }
  if (markdown_content !== undefined && typeof markdown_content !== "string") {
    return E_BAD_REQUEST("markdown_content must be a string");
  }
  if (tags !== undefined && !Array.isArray(tags)) {
    return E_BAD_REQUEST("tags must be an array of strings");
  }

  const admin = createAdminClient();

  // Verify the box lives in the envelope's workspace. The service layer
  // doesn't cross-check box_id → workspace_id, so we do it here to keep the
  // shared-secret trust boundary honest.
  const { data: box, error: boxErr } = await admin
    .from("boxes")
    .select("workspace_id")
    .eq("id", box_id)
    .maybeSingle();
  if (boxErr) {
    console.error("[agent_tools_draft_note] failed to load box", boxErr);
    return E_INTERNAL();
  }
  if (!box || box.workspace_id !== ctx.workspaceId) {
    return apiError(
      "box_not_found",
      "box_id does not belong to the envelope's workspace",
      404
    );
  }

  try {
    const note = await createNoteOnBranch(
      admin,
      ctx.userId,
      ctx.workspaceId,
      ctx.branchId,
      {
        boxId: box_id,
        folderId: folder_id ?? null,
        title: title.trim(),
        markdownContent: markdown_content ?? "",
        summary: summary ?? null,
        tags: tags ?? [],
      }
    );

    return apiOk({
      run_id: ctx.runId,
      note_id: note.id,
      title: note.title,
      branch_id: ctx.branchId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent_tools_draft_note] createNoteOnBranch failed", err);
    // Branch-not-open is a caller-visible condition — surface it, not 500.
    if (message.includes("Branch not found") || message.includes("not open")) {
      return apiError("branch_not_open", message, 409);
    }
    return E_INTERNAL();
  }
}
