import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNoteById } from "@/server/repositories/note_repository";
import { exportBundle } from "@/server/services/export_service";
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
 * POST /api/v1/export_context_bundle
 *
 * Assembles a context bundle for a note and exports it as a signed download.
 *
 * The bundle includes: the entry note, guide note (if assigned and requested),
 * ancestor summary note (if found), and linked notes up to the configured limit.
 * A README with suggested upload order is included. The package is uploaded to
 * private Supabase Storage and a signed URL returned.
 *
 * Authentication:
 *   Bearer token (connection auth). The note's box must be in the connection's
 *   allowed box scope.
 *
 * Request body:
 *   {
 *     "note_id": "<uuid>",
 *     "include_guide": true,            // default true
 *     "include_ancestor_summary": true, // default true
 *     "linked_limit": 10               // default 10, max 10
 *   }
 *
 * Response data:
 *   {
 *     "signed_url": "https://...",
 *     "expires_at": "2026-04-09T14:00:00.000Z",
 *     "filename": "bundle-my-note.zip",
 *     "size_bytes": 8192,
 *     "manifest_summary": {
 *       "export_type": "bundle",
 *       "note_count": 5,
 *       "folder_count": 0,
 *       "link_count": 4
 *     }
 *   }
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "Note not found" || msg === "Not found") return E_NOT_FOUND(msg);
    return E_INTERNAL();
  }
}
