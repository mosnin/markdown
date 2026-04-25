import { type NextRequest } from "next/server";
import { resolveMcpRequestAuth, requireScope } from "@/server/auth/mcp_auth_adapter";
import { canAccessBox } from "@/server/services/oauth_scope_service";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBoxById } from "@/server/repositories/box_repository";
import { getNoteById } from "@/server/repositories/note_repository";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_INSUFFICIENT_SCOPE,
} from "@/lib/api/response";
import { withApiHandler } from "@/server/api/with_api_handler";

/**
 * GET /api/v1/boxes/[box_id]/box_guide
 *
 * Returns the guide note assigned to the box, or null if none is
 * assigned.
 *
 * Auth: OAuth access token with `context:read` scope.
 */
export const GET = withApiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> }
) => {
  const ctx = await resolveMcpRequestAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!requireScope(ctx, "context:read")) {
    return E_INSUFFICIENT_SCOPE("context:read");
  }

  const { box_id } = await params;
  if (!ctx.allowedBoxIds.has(box_id)) return E_FORBIDDEN();
  if (ctx.source === "oauth" && !canAccessBox(ctx.scopes, box_id)) {
    return E_FORBIDDEN();
  }

  const adminClient = createAdminClient();

  const box = await getBoxById(adminClient, box_id);
  if (!box || box.workspace_id !== ctx.workspaceId || box.status === "trashed") {
    return E_NOT_FOUND("Box not found");
  }

  if (!box.guide_note_id) {
    return apiOk({ box_id, guide_note: null });
  }

  const guideNote = await getNoteById(adminClient, box.guide_note_id);
  if (!guideNote || guideNote.status === "trashed") {
    return apiOk({ box_id, guide_note: null });
  }

  return apiOk({
    box_id,
    guide_note: {
      id: guideNote.id,
      title: guideNote.title,
      slug: guideNote.slug,
      path_cache: guideNote.path_cache,
      markdown_content: guideNote.markdown_content,
      summary: guideNote.summary,
      tags: guideNote.tags,
      read_hint: guideNote.read_hint,
      kind: guideNote.kind,
      status: guideNote.status,
      updated_at: guideNote.updated_at,
      created_at: guideNote.created_at,
    },
  });
});
