import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNoteById } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { apiOk, E_UNAUTHORIZED, E_FORBIDDEN, E_NOT_FOUND } from "@/lib/api/response";

/**
 * GET /api/v1/notes/[note_id]
 *
 * Returns a single note by ID, including its full markdown body.
 *
 * Authorization:
 *   - The note's box must be in the connection's allowed box scopes.
 *   - Trashed notes are treated as not found.
 *
 * Response shape:
 *   data: {
 *     id, box_id, folder_id, title, slug, path_cache,
 *     markdown_content, summary, tags, read_hint,
 *     kind, status, created_at, updated_at
 *   }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ note_id: string }> }
) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  const { note_id } = await params;
  const adminClient = createAdminClient();

  const note = await getNoteById(adminClient, note_id);
  if (!note || note.status === "trashed") return E_NOT_FOUND("Note not found");

  // Verify box access
  if (!ctx.allowedBoxIds.has(note.box_id)) return E_FORBIDDEN();

  // Verify workspace ownership (defense in depth)
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
}
