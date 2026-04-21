import { type NextRequest } from "next/server";
import { resolveMcpRequestAuth, requireScope } from "@/server/auth/mcp_auth_adapter";
import { canAccessBox } from "@/server/services/oauth_scope_service";
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
  E_INSUFFICIENT_SCOPE,
  E_RATE_LIMITED,
} from "@/lib/api/response";
import { importExportLimit } from "@/lib/api/rate_limit";

/**
 * POST /api/v1/export_folder
 *
 * Exports a folder and all its descendant folders and notes.
 *
 * Auth: OAuth access token with `context:read` scope.
 */
export async function POST(request: NextRequest) {
  const ctx = await resolveMcpRequestAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!requireScope(ctx, "context:read")) {
    return E_INSUFFICIENT_SCOPE("context:read");
  }

  // Rate limit import/export operations per connection/token.
  const rl = importExportLimit(ctx.connectionId);
  if (!rl.allowed) return E_RATE_LIMITED(rl.retryAfter);

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
  if (!folder.box_id || !ctx.allowedBoxIds.has(folder.box_id)) return E_FORBIDDEN();
  if (ctx.source === "oauth" && !canAccessBox(ctx.scopes, folder.box_id)) {
    return E_FORBIDDEN();
  }

  const box = await getBoxById(adminClient, folder.box_id!);
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
