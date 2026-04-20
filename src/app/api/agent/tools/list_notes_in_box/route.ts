import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listNotesByBox } from "@/server/repositories/note_repository";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

/**
 * POST /api/agent/tools/list_notes_in_box
 *
 * Read-only. Returns the titles and ids of notes in a box so the agent can
 * orient itself before drafting, editing, or archiving. Includes branch
 * overlay when the envelope has a branch_id, so in-progress drafts the agent
 * made earlier in the same run are visible.
 *
 * Body:
 *   - box_id: string (required)
 *   - include_archived?: boolean (default false)
 *   - limit?: number (default 50, max 200)
 *
 * Returns: { run_id, notes: [{note_id, title, summary, tags, status, folder_id}] }
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

  let body: {
    box_id?: string;
    include_archived?: boolean;
    limit?: number;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { box_id, include_archived, limit } = body;
  if (typeof box_id !== "string" || !box_id.trim()) {
    return E_BAD_REQUEST("box_id is required");
  }
  const cappedLimit =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.min(200, Math.max(1, Math.floor(limit)))
      : 50;

  const admin = createAdminClient();

  const { data: box, error: boxErr } = await admin
    .from("boxes")
    .select("workspace_id")
    .eq("id", box_id)
    .maybeSingle();
  if (boxErr) {
    console.error("[agent_tools_list_notes_in_box] failed to load box", boxErr);
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
    const notes = await listNotesByBox(admin, box_id, {
      branchId: ctx.branchId ?? null,
      includeArchived: include_archived === true,
      limit: cappedLimit,
    });

    return apiOk({
      run_id: ctx.runId,
      notes: notes.map((n) => ({
        note_id: n.id,
        title: n.title,
        summary: n.summary ?? null,
        tags: n.tags ?? [],
        status: n.status,
        folder_id: n.folder_id ?? null,
      })),
    });
  } catch (err) {
    console.error("[agent_tools_list_notes_in_box] failed", err);
    return E_INTERNAL();
  }
}
