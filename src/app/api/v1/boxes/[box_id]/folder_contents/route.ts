import { type NextRequest } from "next/server";
import { resolveMcpRequestAuth, requireScope } from "@/server/auth/mcp_auth_adapter";
import { canAccessBox } from "@/server/services/oauth_scope_service";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBoxById } from "@/server/repositories/box_repository";
import { listFoldersByBox, listFoldersByParent, getFolderById } from "@/server/repositories/folder_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_INSUFFICIENT_SCOPE,
} from "@/lib/api/response";
import { withApiHandler } from "@/server/api/with_api_handler";

/**
 * GET /api/v1/boxes/[box_id]/folder_contents
 *
 * Lists folders and notes at a specific level of the box hierarchy.
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

  const searchParams = request.nextUrl.searchParams;
  const folder_id = searchParams.get("folder_id") ?? null;

  const adminClient = createAdminClient();

  const box = await getBoxById(adminClient, box_id);
  if (!box || box.workspace_id !== ctx.workspaceId || box.status === "trashed") {
    return E_NOT_FOUND("Box not found");
  }

  if (folder_id !== null) {
    const folder = await getFolderById(adminClient, folder_id);
    if (!folder || folder.box_id !== box_id || folder.status === "trashed") {
      return E_NOT_FOUND("Folder not found in this box");
    }
  }

  // Canonical API: main-only view. Connection contexts don't carry a branch.
  const [folders, notes] = await Promise.all([
    folder_id
      ? listFoldersByParent(adminClient, folder_id)
      : listFoldersByBox(adminClient, box_id).then((all) =>
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
});
