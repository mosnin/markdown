import { type NextRequest } from "next/server";
import { resolveMcpRequestAuth, requireScope } from "@/server/auth/mcp_auth_adapter";
import { canAccessBox } from "@/server/services/oauth_scope_service";
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
  E_INSUFFICIENT_SCOPE,
} from "@/lib/api/response";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

/**
 * POST /api/v1/search_notes
 *
 * Full-text search within a box using Postgres FTS.
 *
 * Auth: OAuth access token with `context:search` scope.
 */
export async function POST(request: NextRequest) {
  const ctx = await resolveMcpRequestAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!requireScope(ctx, "context:search")) {
    return E_INSUFFICIENT_SCOPE("context:search");
  }

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
  if (ctx.source === "oauth" && !canAccessBox(ctx.scopes, box_id)) {
    return E_FORBIDDEN();
  }

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
