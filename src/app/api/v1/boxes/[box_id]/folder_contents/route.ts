import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBoxById } from "@/server/repositories/box_repository";
import { listFoldersByBox, listFoldersByParent, getFolderById } from "@/server/repositories/folder_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import { apiOk, E_UNAUTHORIZED, E_FORBIDDEN, E_NOT_FOUND, E_BAD_REQUEST } from "@/lib/api/response";

/**
 * GET /api/v1/boxes/[box_id]/folder_contents
 *
 * Lists folders and notes at a specific level of the box hierarchy.
 *
 * Query parameters:
 *   folder_id  — (optional) parent folder ID; omit for box root level
 *
 * Response shape:
 *   data: {
 *     box_id: string,
 *     folder_id: string | null,   // null = root level
 *     folders: Array<{ id, name, slug, path_cache, description, accepts_generated_notes, parent_folder_id }>,
 *     notes: Array<{ id, title, slug, path_cache, summary, tags, read_hint, kind, status, updated_at }>
 *   }
 *
 * Notes: trashed and archived content is excluded. Only active content returned.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ box_id: string }> }
) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  const { box_id } = await params;
  if (!ctx.allowedBoxIds.has(box_id)) return E_FORBIDDEN();

  const searchParams = request.nextUrl.searchParams;
  const folder_id = searchParams.get("folder_id") ?? null;

  const adminClient = createAdminClient();

  const box = await getBoxById(adminClient, box_id);
  if (!box || box.workspace_id !== ctx.workspaceId || box.status === "trashed") {
    return E_NOT_FOUND("Box not found");
  }

  // If a folder_id was given, verify it belongs to this box
  if (folder_id !== null) {
    const folder = await getFolderById(adminClient, folder_id);
    if (!folder || folder.box_id !== box_id || folder.status === "trashed") {
      return E_NOT_FOUND("Folder not found in this box");
    }
  }

  // Fetch child folders and notes at this level.
  // Canonical API: main-only view. Connection contexts don't carry a branch.
  const [folders, notes] = await Promise.all([
    folder_id
      ? listFoldersByParent(adminClient, folder_id)
      : // root level: get all box folders and filter to those without a parent
        listFoldersByBox(adminClient, box_id).then((all) =>
          all.filter((f) => f.parent_folder_id === null)
        ),
    listNotesByBox(adminClient, box_id, { folder_id }),
  ]);

  return apiOk({
    box_id,
    folder_id,
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      slug: f.slug,
      path_cache: f.path_cache,
      description: f.description,
      accepts_generated_notes: f.accepts_generated_notes,
      parent_folder_id: f.parent_folder_id,
      created_at: f.created_at,
      updated_at: f.updated_at,
    })),
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      slug: n.slug,
      path_cache: n.path_cache,
      folder_id: n.folder_id,
      summary: n.summary,
      tags: n.tags,
      read_hint: n.read_hint,
      kind: n.kind,
      status: n.status,
      updated_at: n.updated_at,
      created_at: n.created_at,
    })),
  });
}
