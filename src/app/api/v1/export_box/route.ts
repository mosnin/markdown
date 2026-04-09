import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBoxById } from "@/server/repositories/box_repository";
import { exportBox, packageToZip } from "@/server/services/export_service";
import {
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";

/**
 * POST /api/v1/export_box
 *
 * Exports an entire box (all folders + notes) as a .zip package.
 * Returns raw binary ZIP, not base64.
 *
 * Request body:
 *   { box_id: string }
 *
 * Response:
 *   Content-Type: application/zip
 *   Content-Disposition: attachment; filename="<package-filename>.zip"
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
