import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBoxById } from "@/server/repositories/box_repository";
import { searchNotes } from "@/server/services/search_service";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

/**
 * POST /api/v1/search_notes
 *
 * Full-text search within a box using Postgres FTS.
 * Search is always box-scoped — cross-box search is not supported in V1.
 *
 * Request body:
 *   {
 *     box_id: string,     // must be in the connection's allowed box scopes
 *     query: string,      // search query; empty string returns []
 *     limit?: number      // default 20, max 50
 *   }
 *
 * Response shape:
 *   data: {
 *     box_id: string,
 *     query: string,
 *     limit: number,
 *     results: Array<{
 *       id, title, slug, path_cache, summary, tags, read_hint, kind, status,
 *       updated_at, rank
 *     }>
 *   }
 */
export async function POST(request: NextRequest) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  let body: { box_id?: string; query?: string; limit?: number };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { box_id, query, limit: rawLimit } = body;
  if (!box_id) return E_BAD_REQUEST("box_id is required");
  if (typeof query !== "string") return E_BAD_REQUEST("query must be a string");

  if (!ctx.allowedBoxIds.has(box_id)) return E_FORBIDDEN();

  const limit = Math.min(
    Math.max(1, Number.isInteger(rawLimit) ? (rawLimit as number) : DEFAULT_LIMIT),
    MAX_LIMIT
  );

  const adminClient = createAdminClient();

  const box = await getBoxById(adminClient, box_id);
  if (!box || box.workspace_id !== ctx.workspaceId || box.status === "trashed") {
    return E_NOT_FOUND("Box not found");
  }

  try {
    const results = await searchNotes(adminClient, box_id, query, limit);
    return apiOk({
      box_id,
      query,
      limit,
      results: results.map((n) => ({
        id: n.id,
        box_id: n.box_id,
        folder_id: n.folder_id,
        title: n.title,
        slug: n.slug,
        path_cache: n.path_cache,
        summary: n.summary,
        tags: n.tags,
        read_hint: n.read_hint,
        kind: n.kind,
        status: n.status,
        updated_at: n.updated_at,
        rank: n.rank,
      })),
    });
  } catch {
    return E_INTERNAL();
  }
}
