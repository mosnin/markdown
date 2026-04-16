import { type NextRequest } from "next/server";
import { resolveMcpRequestAuth, requireScope } from "@/server/auth/mcp_auth_adapter";
import { canAccessBox } from "@/server/services/oauth_scope_service";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBoxById } from "@/server/repositories/box_repository";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_INSUFFICIENT_SCOPE,
} from "@/lib/api/response";

/**
 * GET /api/v1/boxes
 *
 * Returns the list of boxes this token has been scoped to.
 * Only active (non-trashed) boxes are returned.
 *
 * Auth: OAuth access token with `context:read` scope.
 */
export async function GET(request: NextRequest) {
  const ctx = await resolveMcpRequestAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!requireScope(ctx, "context:read")) {
    return E_INSUFFICIENT_SCOPE("context:read");
  }

  if (ctx.allowedBoxIds.size === 0) {
    return apiOk([]);
  }

  const adminClient = createAdminClient();

  const boxResults = await Promise.all(
    Array.from(ctx.allowedBoxIds).map((boxId) =>
      getBoxById(adminClient, boxId)
    )
  );

  const boxes = boxResults
    .filter(
      (box) =>
        box !== null &&
        box.workspace_id === ctx.workspaceId &&
        box.status !== "trashed"
    )
    .filter((box) => {
      if (ctx.source !== "oauth") return true;
      return canAccessBox(ctx.scopes, box!.id);
    })
    .map((box) => ({
      id: box!.id,
      name: box!.name,
      slug: box!.slug,
      description: box!.description,
      guide_note_id: box!.guide_note_id,
      created_at: box!.created_at,
      updated_at: box!.updated_at,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return apiOk(boxes);
}
