import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBoxById } from "@/server/repositories/box_repository";
import { exportBox } from "@/server/services/export_service";
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
 * POST /api/v1/export_box
 *
 * Exports an entire box: all active folders, notes, and qualifying links.
 *
 * The package is assembled server-side, uploaded to private Supabase Storage,
 * and a short-lived signed URL is returned. The caller downloads the zip by
 * GETting the signed_url before it expires (1 hour).
 *
 * Authentication:
 *   Bearer token (connection auth). The box must be in the connection's
 *   allowed box scope.
 *
 * Request body:
 *   { "box_id": "<uuid>" }
 *
 * Response data:
 *   {
 *     "signed_url": "https://...",
 *     "expires_at": "2026-04-09T14:00:00.000Z",
 *     "filename": "my-box-box.zip",
 *     "size_bytes": 65536,
 *     "manifest_summary": {
 *       "export_type": "box",
 *       "note_count": 42,
 *       "folder_count": 8,
 *       "link_count": 17
 *     }
 *   }
 */
export async function POST(request: NextRequest) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  let body: { box_id?: string };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { box_id } = body;
  if (!box_id) return E_BAD_REQUEST("box_id is required");

  if (!ctx.allowedBoxIds.has(box_id)) return E_FORBIDDEN();

  const adminClient = createAdminClient();

  const box = await getBoxById(adminClient, box_id);
  if (!box || box.workspace_id !== ctx.workspaceId || box.status === "trashed") {
    return E_NOT_FOUND("Box not found");
  }

  try {
    const pkg = await exportBox(adminClient, ctx.workspaceId, box_id);
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
