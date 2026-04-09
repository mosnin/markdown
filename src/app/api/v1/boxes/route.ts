import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBoxById } from "@/server/repositories/box_repository";
import { apiOk, E_UNAUTHORIZED } from "@/lib/api/response";

/**
 * GET /api/v1/boxes
 *
 * Returns the list of boxes this connection has been scoped to.
 * Only active (non-trashed, non-archived) boxes are returned.
 *
 * Response shape:
 *   data: Array<{ id, name, slug, description, guide_note_id, created_at, updated_at }>
 */
export async function GET(request: NextRequest) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  if (ctx.allowedBoxIds.size === 0) {
    return apiOk([]);
  }

  const adminClient = createAdminClient();

  // Fetch each allowed box and verify workspace ownership
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
