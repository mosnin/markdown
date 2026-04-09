import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBoxById } from "@/server/repositories/box_repository";
import { getBoxOverview } from "@/server/services/overview_service";
import { apiOk, E_UNAUTHORIZED, E_FORBIDDEN, E_NOT_FOUND, E_INTERNAL } from "@/lib/api/response";

/**
 * GET /api/v1/boxes/[box_id]/box_overview
 *
 * Returns the full hierarchy and link graph for the box.
 * Nodes represent folders and notes; edges represent note_links.
 *
 * Hard limits: 1000 nodes, 2000 edges.
 * When truncated, data.truncated is true.
 *
 * Response shape:
 *   data: {
 *     box: { id, name, slug, description, guide_note_id },
 *     nodes: Array<{ id, kind, label, path, noteKind?, parentFolderId, parentId }>,
 *     edges: Array<{ id, sourceNoteId, targetNoteId, relationshipType }>,
 *     folderCount: number,
 *     noteCount: number,
 *     edgeCount: number,
 *     truncated: boolean
 *   }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ box_id: string }> }
) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  const { box_id } = await params;
  if (!ctx.allowedBoxIds.has(box_id)) return E_FORBIDDEN();

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
