import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNoteById } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { exportNote, packageToZip } from "@/server/services/export_service";
import {
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";

/**
 * POST /api/v1/export_note
 *
 * Exports a single note as a .zip package and returns the binary file.
 * Unlike the human app export (which returns base64), this endpoint returns
 * the raw binary ZIP directly with appropriate Content-Type headers.
 *
 * Request body:
 *   { note_id: string }
 *
 * Response:
 *   Content-Type: application/zip
 *   Content-Disposition: attachment; filename="<package-filename>.zip"
 *   Body: raw ZIP binary
 */
export async function POST(request: NextRequest) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  let body: { note_id?: string };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { note_id } = body;
  if (!note_id) return E_BAD_REQUEST("note_id is required");

  const adminClient = createAdminClient();

  const note = await getNoteById(adminClient, note_id);
  if (!note || note.status === "trashed") return E_NOT_FOUND("Note not found");
  if (!ctx.allowedBoxIds.has(note.box_id)) return E_FORBIDDEN();

  const box = await getBoxById(adminClient, note.box_id);
  if (!box || box.workspace_id !== ctx.workspaceId) return E_FORBIDDEN();

  try {
    const pkg = await exportNote(adminClient, ctx.workspaceId, note_id);
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
