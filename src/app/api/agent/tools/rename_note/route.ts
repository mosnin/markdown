import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  updateNoteOnBranch,
  getNoteForWorkspace,
} from "@/server/services/note_service";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_FORBIDDEN,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

/**
 * POST /api/agent/tools/rename_note
 *
 * Rename a note on the envelope's draft branch. Writes a new branch-scoped
 * version with the new title but the existing markdown body — the user
 * sees the rename in the diff and can promote or discard.
 *
 * Body: { note_id: string, new_title: string }
 * Returns: { run_id, note_id, title, branch_id, version_id, version_number }
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
      "rename_note requires a branch_id envelope header — the agent cannot write to main"
    );
  }

  let body: { note_id?: string; new_title?: string };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { note_id, new_title } = body;
  if (typeof note_id !== "string" || !note_id.trim()) {
    return E_BAD_REQUEST("note_id is required");
  }
  if (typeof new_title !== "string" || !new_title.trim()) {
    return E_BAD_REQUEST("new_title is required and must be non-empty");
  }
  if (new_title.length > 500) {
    return E_BAD_REQUEST("new_title must be 500 characters or fewer");
  }

  const admin = createAdminClient();
  const existing = await getNoteForWorkspace(
    admin,
    note_id,
    ctx.workspaceId,
    ctx.branchId
  );
  if (!existing) {
    return apiError("note_not_found", "note_id not found in this workspace", 404);
  }

  try {
    const result = await updateNoteOnBranch(
      admin,
      ctx.userId,
      ctx.workspaceId,
      ctx.branchId,
      note_id,
      {
        title: new_title.trim(),
        markdownContent: existing.markdown_content ?? "",
        summary: existing.summary ?? null,
        tags: existing.tags ?? [],
      }
    );
    return apiOk({
      run_id: ctx.runId,
      note_id: result.note_id,
      title: new_title.trim(),
      branch_id: result.branch_id,
      version_id: result.version_id,
      version_number: result.version_number,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent_tools_rename_note] failed", err);
    if (message.includes("Branch not found") || message.includes("not open")) {
      return apiError("branch_not_open", message, 409);
    }
    if (message.includes("Note not found")) {
      return apiError("note_not_found", message, 404);
    }
    return E_INTERNAL();
  }
}
