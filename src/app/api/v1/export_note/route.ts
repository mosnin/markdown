import { type NextRequest } from "next/server";
import { resolveMcpRequestAuth, requireScope } from "@/server/auth/mcp_auth_adapter";
import { canAccessBox } from "@/server/services/oauth_scope_service";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNoteById } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { exportNote } from "@/server/services/export_service";
import { deliverExportPackage } from "@/server/services/artifact_delivery_service";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_INSUFFICIENT_SCOPE,
  E_RATE_LIMITED,
} from "@/lib/api/response";
import { importExportLimit } from "@/lib/api/rate_limit";
import { withApiHandler } from "@/server/api/with_api_handler";

/**
 * POST /api/v1/export_note
 *
 * Exports a single note as a signed download package.
 *
 * Auth: OAuth access token with `context:read` scope.
 */
export const POST = withApiHandler(async (request: NextRequest) => {
  const ctx = await resolveMcpRequestAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!requireScope(ctx, "context:read")) {
    return E_INSUFFICIENT_SCOPE("context:read");
  }

  // Rate limit import/export operations per connection/token.
  const rl = await importExportLimit(ctx.connectionId);
  if (!rl.allowed) return E_RATE_LIMITED(rl.retryAfter);

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
  if (ctx.source === "oauth" && !canAccessBox(ctx.scopes, note.box_id)) {
    return E_FORBIDDEN();
  }

  const box = await getBoxById(adminClient, note.box_id);
  if (!box || box.workspace_id !== ctx.workspaceId) return E_FORBIDDEN();

  try {
    const pkg = await exportNote(adminClient, ctx.workspaceId, note_id);
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
});
