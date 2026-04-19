import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getTemplate,
  applyTemplate,
} from "@/server/services/note_template_service";
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
 * POST /api/agent/tools/apply_template
 *
 * Internal endpoint invoked by the Workspace Operator. Loads a template,
 * substitutes its `{{variable}}` placeholders, and creates the resulting
 * note on the envelope's draft branch.
 *
 * Body:
 *   - template_id: string (required)
 *   - title: string (required)
 *   - variables?: Record<string, string>
 *   - box_id: string (required) — must match the template's box and the
 *     envelope's workspace
 *
 * Returns: { note_id, title, branch_id, template_id }
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
    template_id?: string;
    title?: string;
    variables?: Record<string, string>;
    box_id?: string;
    folder_id?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { template_id, title, variables, box_id, folder_id } = body;
  if (typeof template_id !== "string" || !template_id.trim()) {
    return E_BAD_REQUEST("template_id is required");
  }
  if (typeof title !== "string" || !title.trim()) {
    return E_BAD_REQUEST("title is required and must be a non-empty string");
  }
  if (title.length > 500) {
    return E_BAD_REQUEST("title must be 500 characters or fewer");
  }
  if (typeof box_id !== "string" || !box_id.trim()) {
    return E_BAD_REQUEST("box_id is required");
  }
  if (
    variables !== undefined &&
    (typeof variables !== "object" ||
      variables === null ||
      Array.isArray(variables))
  ) {
    return E_BAD_REQUEST("variables must be an object of string values");
  }

  const admin = createAdminClient();

  let template;
  try {
    template = await getTemplate(admin, template_id);
  } catch (err) {
    console.error("[agent_tools_apply_template] getTemplate failed", err);
    return E_INTERNAL();
  }
  if (!template) {
    return apiError("template_not_found", "template_id not found", 404);
  }
  if (template.workspace_id !== ctx.workspaceId) {
    return apiError(
      "template_not_found",
      "template_id does not belong to this workspace",
      404
    );
  }
  if (template.box_id !== box_id) {
    return E_BAD_REQUEST("box_id does not match the template's box");
  }

  // Verify the box lives in the envelope's workspace.
  const { data: box, error: boxErr } = await admin
    .from("boxes")
    .select("workspace_id")
    .eq("id", box_id)
    .maybeSingle();
  if (boxErr) {
    console.error("[agent_tools_apply_template] failed to load box", boxErr);
    return E_INTERNAL();
  }
  if (!box || box.workspace_id !== ctx.workspaceId) {
    return apiError(
      "box_not_found",
      "box_id does not belong to the envelope's workspace",
      404
    );
  }

  const rendered = applyTemplate(template.markdown_content ?? "", variables ?? {});

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
        markdownContent: rendered,
        tags: template.tags ?? [],
      }
    );

    return apiOk({
      run_id: ctx.runId,
      note_id: note.id,
      title: note.title,
      branch_id: ctx.branchId,
      template_id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent_tools_apply_template] createNoteOnBranch failed", err);
    if (message.includes("Branch not found") || message.includes("not open")) {
      return apiError("branch_not_open", message, 409);
    }
    return E_INTERNAL();
  }
}
