import { type NextRequest } from "next/server";
import { resolveMcpRequestAuth, requireScope } from "@/server/auth/mcp_auth_adapter";
import { canAccessBox } from "@/server/services/oauth_scope_service";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBoxById } from "@/server/repositories/box_repository";
import { getBoxOverview } from "@/server/services/overview_service";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_INTERNAL,
  E_INSUFFICIENT_SCOPE,
} from "@/lib/api/response";

/**
 * GET /api/v1/boxes/[box_id]/box_overview
 *
 * Returns the full hierarchy and link graph for the box.
 *
 * Auth: OAuth access token with `context:read` scope.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ box_id: string }> }
) {
  const ctx = await resolveMcpRequestAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!requireScope(ctx, "context:read")) {
    return E_INSUFFICIENT_SCOPE("context:read");
  }

  const { box_id } = await params;
  if (!ctx.allowedBoxIds.has(box_id)) return E_FORBIDDEN();
  if (ctx.source === "oauth" && !canAccessBox(ctx.scopes, box_id)) {
    return E_FORBIDDEN();
  }

  const adminClient = createAdminClient();

  const box = await getBoxById(adminClient, box_id);
  if (!box || box.workspace_id !== ctx.workspaceId || box.status === "trashed") {
    return E_NOT_FOUND("Box not found");
  }

  try {
    const overview = await getBoxOverview(adminClient, box);
    return apiOk({
      box: {
        id: overview.box.id,
        name: overview.box.name,
        slug: overview.box.slug,
        description: overview.box.description,
        guide_note_id: overview.box.guide_note_id,
      },
      nodes: overview.nodes,
      edges: overview.edges,
      folder_count: overview.folderCount,
      note_count: overview.noteCount,
      edge_count: overview.edgeCount,
      truncated: overview.truncated,
    });
  } catch {
    return E_INTERNAL();
  }
}
