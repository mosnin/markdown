import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNoteById } from "@/server/repositories/note_repository";
import { assembleContextBundle } from "@/server/services/context_bundle_service";
import { auditBundleReadByConnection } from "@/server/services/audit_service";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";

/**
 * POST /api/v1/context_bundles
 *
 * Assembles a bounded, deterministic context bundle centered on a note.
 * The bundle includes the target note, guide note, linked notes, ancestor
 * summary note, and relationship edges — all ranked and deduplicated.
 *
 * Request body:
 *   {
 *     note_id: string,
 *     include_guide?: boolean,            // default true
 *     include_ancestor_summary?: boolean, // default true
 *     include_archived?: boolean,         // default false
 *     linked_limit?: number               // default 10, max 10
 *   }
 *
 * Response shape:
 *   data: ContextBundle  (see src/server/domain/types/context_bundle.ts)
 */
export async function POST(request: NextRequest) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  let body: {
    note_id?: string;
    include_guide?: boolean;
    include_ancestor_summary?: boolean;
    include_archived?: boolean;
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

  // Pre-check note existence and box authorization before assembling
  const note = await getNoteById(adminClient, note_id);
  if (!note || note.status === "trashed") return E_NOT_FOUND("Note not found");
  if (!ctx.allowedBoxIds.has(note.box_id)) return E_FORBIDDEN();

  try {
    const bundle = await assembleContextBundle(
      adminClient,
      ctx.workspaceId,
      note_id,
      {
        includeGuide: body.include_guide ?? true,
        includeAncestorSummary: body.include_ancestor_summary ?? true,
        includeArchived: body.include_archived ?? false,
        linkedLimit: body.linked_limit ?? 10,
      }
    );
    // Audit the bundle read (fire-and-forget — must not abort the response).
    auditBundleReadByConnection(adminClient, ctx.workspaceId, ctx.connection.id, note_id, {
      box_id: bundle.box.id,
      linked_count: bundle.linked_notes.length,
      guide_included: bundle.guide_note !== null,
      ancestor_summary_included: bundle.ancestor_summary_note !== null,
      truncated: bundle.truncated,
    });
    return apiOk(bundle);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Assembly failed";
    if (msg === "Note not found" || msg === "Not found") return E_NOT_FOUND(msg);
    return E_INTERNAL();
  }
}
