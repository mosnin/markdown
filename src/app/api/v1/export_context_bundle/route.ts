import { type NextRequest } from "next/server";
import { resolveMcpRequestAuth, requireScope } from "@/server/auth/mcp_auth_adapter";
import { canAccessBox } from "@/server/services/oauth_scope_service";
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
  E_INSUFFICIENT_SCOPE,
  E_RATE_LIMITED,
} from "@/lib/api/response";
import { importExportLimit } from "@/lib/api/rate_limit";

/**
 * POST /api/v1/export_context_bundle
 *
 * Assembles a context bundle for a note and exports it as a signed
 * download.
 *
 * Auth: OAuth access token with `context:bundles` scope.
 */
export async function POST(request: NextRequest) {
  const ctx = await resolveMcpRequestAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!requireScope(ctx, "context:bundles")) {
    return E_INSUFFICIENT_SCOPE("context:bundles");
  }

  // Rate limit import/export operations per connection/token.
  const rl = importExportLimit(ctx.connectionId);
  if (!rl.allowed) return E_RATE_LIMITED(rl.retryAfter);

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
  if (ctx.source === "oauth" && !canAccessBox(ctx.scopes, note.box_id)) {
    return E_FORBIDDEN();
  }

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
