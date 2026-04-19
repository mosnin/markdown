import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateNoteOnBranch, getNoteForWorkspace } from "@/server/services/note_service";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_FORBIDDEN,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

/**
 * POST /api/agent/tools/edit_note
 *
 * Internal endpoint invoked by the Workspace Operator. Replaces the body
 * of an existing note on the envelope's draft branch — never on main.
 * The branch_id comes from the envelope so the agent has no way to pick
 * a different target.
 *
 * Body:
 *   - note_id: string (required)
 *   - new_content: string (required) — full replacement Markdown
 *   - edit_summary?: string | null
 *
 * Returns: { note_id, branch_id, version_id, version_number }
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
    note_id?: string;
    new_content?: string;
    edit_summary?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { note_id, new_content, edit_summary } = body;
  if (typeof note_id !== "string" || !note_id.trim()) {
    return E_BAD_REQUEST("note_id is required and must be a non-empty string");
  }
  if (typeof new_content !== "string") {
    return E_BAD_REQUEST("new_content is required and must be a string");
  }
  if (
    edit_summary !== undefined &&
    edit_summary !== null &&
    typeof edit_summary !== "string"
  ) {
    return E_BAD_REQUEST("edit_summary must be a string when provided");
  }

  const admin = createAdminClient();

  // We need the title to round-trip through the version (RPC needs title);
  // load it from the existing note (workspace-scoped).
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
        title: existing.title,
        markdownContent: new_content,
        summary: edit_summary ?? existing.summary ?? null,
        tags: existing.tags ?? [],
      }
    );

    return apiOk({
      run_id: ctx.runId,
      note_id: result.note_id,
      branch_id: result.branch_id,
      version_id: result.version_id,
      version_number: result.version_number,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent_tools_edit_note] updateNoteOnBranch failed", err);
    if (message.includes("Branch not found") || message.includes("not open")) {
      return apiError("branch_not_open", message, 409);
    }
    if (message.includes("Note not found")) {
      return apiError("note_not_found", message, 404);
    }
    return E_INTERNAL();
  }
}
