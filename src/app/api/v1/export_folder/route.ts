import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderById } from "@/server/repositories/folder_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { exportFolder, packageToZip } from "@/server/services/export_service";
import {
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";

/**
 * POST /api/v1/export_folder
 *
 * Exports a folder and all its notes as a .zip package.
 * Returns raw binary ZIP, not base64.
 *
 * Request body:
 *   { folder_id: string }
 *
 * Response:
 *   Content-Type: application/zip
 *   Content-Disposition: attachment; filename="<package-filename>.zip"
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
    const zip = packageToZip(pkg);

    return new Response(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${pkg.filename}"`,
        "Content-Length": String(zip.length),
      },
    });
  } catch {
    return E_INTERNAL();
  }
}
