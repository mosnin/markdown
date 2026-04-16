import { type NextRequest } from "next/server";
import { resolveMcpRequestAuth, requireScope } from "@/server/auth/mcp_auth_adapter";
import { canAccessBox } from "@/server/services/oauth_scope_service";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNoteById } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { listVersionsByNote } from "@/server/repositories/note_version_repository";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INSUFFICIENT_SCOPE,
} from "@/lib/api/response";

/**
 * GET /api/v1/notes/[note_id]/versions
 *
 * Returns paginated version history for a note. Versions are ordered newest
 * first (descending version_number).
 *
 * Auth: OAuth access token with `context:read` scope.
 *
 * Note: rollback is intentionally not available through this API. It is a
 * human-only operation in V1.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ note_id: string }> }
) {
  const ctx = await resolveMcpRequestAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!requireScope(ctx, "context:read")) {
    return E_INSUFFICIENT_SCOPE("context:read");
  }

  const { note_id } = await params;

  const rawLimit = request.nextUrl.searchParams.get("limit");
  const rawPage = request.nextUrl.searchParams.get("page");

  const limit = Math.min(Math.max(parseInt(rawLimit ?? "50", 10) || 50, 1), 100);
  const page = Math.max(parseInt(rawPage ?? "1", 10) || 1, 1);
  const offset = (page - 1) * limit;

  if (isNaN(limit) || isNaN(page)) return E_BAD_REQUEST("Invalid limit or page");

  const adminClient = createAdminClient();

  const note = await getNoteById(adminClient, note_id);
  if (!note || note.status === "trashed") return E_NOT_FOUND();

  if (!ctx.allowedBoxIds.has(note.box_id)) return E_FORBIDDEN();
  if (ctx.source === "oauth" && !canAccessBox(ctx.scopes, note.box_id)) {
    return E_FORBIDDEN();
  }

  const box = await getBoxById(adminClient, note.box_id);
  if (!box || box.workspace_id !== ctx.workspaceId) return E_FORBIDDEN();

  const versions = await listVersionsByNote(adminClient, note_id, { limit, offset });
  const items = versions.map(({ markdown_content: _omit, ...rest }) => rest);

  return apiOk({
    note_id,
    current_version_id: note.current_version_id ?? null,
    versions: items,
    total_fetched: items.length,
    limit,
    page,
  });
}
