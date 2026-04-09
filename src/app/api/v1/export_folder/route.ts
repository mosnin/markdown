import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderById } from "@/server/repositories/folder_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { exportFolder } from "@/server/services/export_service";
import { deliverExportPackage } from "@/server/services/artifact_delivery_service";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";

/**
 * POST /api/v1/export_folder
 *
 * Exports a folder and all its descendant folders and notes.
 *
 * The package is assembled server-side, uploaded to private Supabase Storage,
 * and a short-lived signed URL is returned. The caller downloads the zip by
 * GETting the signed_url before it expires (1 hour).
 *
 * Authentication:
 *   Bearer token (connection auth). The folder's box must be in the
 *   connection's allowed box scope.
 *
 * Request body:
 *   { "folder_id": "<uuid>" }
 *
 * Response data:
 *   {
 *     "signed_url": "https://...",
 *     "expires_at": "2026-04-09T14:00:00.000Z",
 *     "filename": "my-folder-folder.zip",
 *     "size_bytes": 12288,
 *     "manifest_summary": {
 *       "export_type": "folder",
 *       "note_count": 5,
 *       "folder_count": 2,
 *       "link_count": 3
 *     }
 *   }
 */
export async function POST(request: NextRequest) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  let body: { folder_id?: string };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { folder_id } = body;
  if (!folder_id) return E_BAD_REQUEST("folder_id is required");

  const adminClient = createAdminClient();

  const folder = await getFolderById(adminClient, folder_id);
  if (!folder || folder.status === "trashed") return E_NOT_FOUND("Folder not found");
  if (!ctx.allowedBoxIds.has(folder.box_id)) return E_FORBIDDEN();

  const box = await getBoxById(adminClient, folder.box_id);
  if (!box || box.workspace_id !== ctx.workspaceId) return E_FORBIDDEN();

  try {
    const pkg = await exportFolder(adminClient, ctx.workspaceId, folder_id);
    const delivery = await deliverExportPackage(adminClient, ctx.workspaceId, pkg);

    return apiOk({
      ...delivery,
      manifest_summary: {
        export_type: pkg.manifest.export_type,
        note_count: pkg.manifest.counts.notes,
        folder_count: pkg.manifest.counts.folders,
        link_count: pkg.manifest.counts.links,
      },
    });
  } catch {
    return E_INTERNAL();
  }
}
