import { type NextRequest } from "next/server";
import { resolveMcpRequestAuth, requireScope } from "@/server/auth/mcp_auth_adapter";
import { canAccessBox } from "@/server/services/oauth_scope_service";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNoteById } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_INSUFFICIENT_SCOPE,
} from "@/lib/api/response";
import { withApiHandler } from "@/server/api/with_api_handler";

/**
 * GET /api/v1/notes/[note_id]
 *
 * Returns a single note by ID, including its full markdown body.
 *
 * Auth: OAuth access token with `context:read` scope.
 *
 * Authorization:
 *   - The note's box must be in the token's allowed box set.
 *   - Box-scoped tokens are further narrowed via `canAccessBox`.
 *   - Trashed notes are treated as not found.
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

  const { note_id } = await params;
  const adminClient = createAdminClient();

  const note = await getNoteById(adminClient, note_id);
  if (!note || note.status === "trashed") return E_NOT_FOUND("Note not found");

  // Box-scope gate (OAuth capability + context:box:<uuid> narrowing)
  if (!ctx.allowedBoxIds.has(note.box_id)) return E_FORBIDDEN();
  if (ctx.source === "oauth" && !canAccessBox(ctx.scopes, note.box_id)) {
    return E_FORBIDDEN();
  }

  // Defense in depth: verify the box really is in the same workspace.
  const box = await getBoxById(adminClient, note.box_id);
  if (!box || box.workspace_id !== ctx.workspaceId) return E_FORBIDDEN();

  return apiOk({
    id: note.id,
    box_id: note.box_id,
    folder_id: note.folder_id,
    title: note.title,
    slug: note.slug,
    path_cache: note.path_cache,
    markdown_content: note.markdown_content,
    summary: note.summary,
    tags: note.tags,
    read_hint: note.read_hint,
    kind: note.kind,
    status: note.status,
    origin_type: note.origin_type,
    is_generated: note.is_generated,
    generated_by_connection_id: note.generated_by_connection_id,
    created_at: note.created_at,
    updated_at: note.updated_at,
  });
});
