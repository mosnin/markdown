import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNoteById } from "@/server/repositories/note_repository";
import { exportBundle, packageToZip } from "@/server/services/export_service";
import {
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";

/**
 * POST /api/v1/export_context_bundle
 *
 * Assembles a context bundle for a note and exports it as a .zip package.
 * The ZIP includes a manifest, individual note files, and a README with the
 * suggested reading order.
 * Returns raw binary ZIP, not base64.
 *
 * Request body:
 *   {
 *     note_id: string,
 *     include_guide?: boolean,            // default true
 *     include_ancestor_summary?: boolean, // default true
 *     linked_limit?: number               // default 10, max 10
 *   }
 *
 * Response:
 *   Content-Type: application/zip
 *   Content-Disposition: attachment; filename="<package-filename>.zip"
 */
export async function POST(request: NextRequest) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  let body: {
    note_id?: string;
    include_guide?: boolean;
    include_ancestor_summary?: boolean;
    linked_limit?: number;
  };
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

  try {
    const pkg = await exportBundle(adminClient, ctx.workspaceId, note_id, {
      includeGuide: body.include_guide ?? true,
      includeAncestorSummary: body.include_ancestor_summary ?? true,
      linkedLimit: body.linked_limit ?? 10,
    });
    const zip = packageToZip(pkg);

    return new Response(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${pkg.filename}"`,
        "Content-Length": String(zip.length),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "Note not found" || msg === "Not found") return E_NOT_FOUND(msg);
    return E_INTERNAL();
  }
}
