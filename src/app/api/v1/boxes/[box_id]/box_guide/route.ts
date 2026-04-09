import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBoxById } from "@/server/repositories/box_repository";
import { getNoteById } from "@/server/repositories/note_repository";
import { apiOk, E_UNAUTHORIZED, E_FORBIDDEN, E_NOT_FOUND } from "@/lib/api/response";

/**
 * GET /api/v1/boxes/[box_id]/box_guide
 *
 * Returns the guide note assigned to the box, or null if none is assigned.
 * The guide note is set via boxes.guide_note_id.
 *
 * Response shape:
 *   data: {
 *     box_id: string,
 *     guide_note: { id, title, markdown_content, summary, tags, read_hint, kind, path_cache, updated_at } | null
 *   }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ box_id: string }> }
) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  const { box_id } = await params;
  if (!ctx.allowedBoxIds.has(box_id)) return E_FORBIDDEN();

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
}
