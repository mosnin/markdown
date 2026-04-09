import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
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
} from "@/lib/api/response";

/**
 * GET /api/v1/notes/[note_id]/versions
 *
 * Returns paginated version history for a note. Versions are ordered newest
 * first (descending version_number). All versions are returned — rollback,
 * proposal_approved, human_edit, import, and generated origins are all visible.
 *
 * Authorization:
 *   - Connection bearer token required.
 *   - Note's box must be in the connection's allowed box scopes.
 *   - Trashed notes are treated as not found.
 *
 * Query parameters:
 *   limit  integer  default 50, max 100
 *   page   integer  default 1 (1-based)
 *
 * Response data:
 *   {
 *     note_id: string,
 *     current_version_id: string | null,
 *     versions: Array<{
 *       id, note_id, parent_version_id, version_number,
 *       title, content_bytes, actor_type, actor_id, change_origin,
 *       diff_summary, created_at
 *       // markdown_content intentionally omitted — fetch individual note for content
 *     }>,
 *     total_fetched: number,
 *     limit: number,
 *     page: number
 *   }
 *
 * Note: markdown_content is excluded from the list to keep the payload bounded.
 * Use GET /api/v1/notes/[id] to read the current full content.
 *
 * Note: rollback is intentionally not available through this API. Rollback is
 * a human-only operation in V1 and is performed via the human app server actions.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ note_id: string }> }
) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  const { note_id } = await params;

  const rawLimit = request.nextUrl.searchParams.get("limit");
  const rawPage = request.nextUrl.searchParams.get("page");

  const limit = Math.min(Math.max(parseInt(rawLimit ?? "50", 10) || 50, 1), 100);
  const page = Math.max(parseInt(rawPage ?? "1", 10) || 1, 1);
  const offset = (page - 1) * limit;

  if (isNaN(limit) || isNaN(page)) return E_BAD_REQUEST("Invalid limit or page");

  const adminClient = createAdminClient();

  // Load note and verify it exists and is not trashed
  const note = await getNoteById(adminClient, note_id);
  if (!note || note.status === "trashed") return E_NOT_FOUND();

  // Verify box is in connection scope
  if (!ctx.allowedBoxIds.has(note.box_id)) return E_FORBIDDEN();

  // Defense in depth: verify box belongs to connection's workspace
  const box = await getBoxById(adminClient, note.box_id);
  if (!box || box.workspace_id !== ctx.workspaceId) return E_FORBIDDEN();

  const versions = await listVersionsByNote(adminClient, note_id, { limit, offset });

  // Omit markdown_content from list items to keep the payload bounded
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
