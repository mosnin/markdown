import { type NextRequest } from "next/server";
import { resolveMcpRequestAuth, requireScope } from "@/server/auth/mcp_auth_adapter";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  semanticSearch,
  hybridSearch,
} from "@/server/services/embedding_service";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_INSUFFICIENT_SCOPE,
} from "@/lib/api/response";
import { withApiHandler } from "@/server/api/with_api_handler";

/**
 * POST /api/v1/semantic_search
 *
 * Vector-based semantic search across notes in a workspace.
 *
 * Auth: OAuth access token with `context:search` scope.
 *
 * Body:
 *   - query: string (required) — natural-language search query
 *   - limit?: number — max results (default 20, max 50)
 *   - workspace_id?: string — workspace to search (defaults to token's workspace)
 *   - mode?: "semantic" | "hybrid" — search mode (default "semantic")
 *
 * Returns ranked results with similarity scores.
 */
export const POST = withApiHandler(async (request: NextRequest) => {
  const ctx = await resolveMcpRequestAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!requireScope(ctx, "context:search")) {
    return E_INSUFFICIENT_SCOPE("context:search");
  }

  let body: {
    query?: string;
    limit?: number;
    workspace_id?: string;
    mode?: string;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { query, limit: rawLimit, workspace_id, mode } = body;
  if (typeof query !== "string" || !query.trim()) {
    return E_BAD_REQUEST("query is required and must be a non-empty string");
  }

  const MAX_LIMIT = 50;
  const DEFAULT_LIMIT = 20;
  const limit = Math.min(
    Math.max(1, Number.isInteger(rawLimit) ? (rawLimit as number) : DEFAULT_LIMIT),
    MAX_LIMIT
  );

  // Use the token's workspace unless overridden (and the override matches).
  const workspaceId = workspace_id ?? ctx.workspaceId;
  if (workspaceId !== ctx.workspaceId) {
    return E_BAD_REQUEST("workspace_id must match the token's authorized workspace");
  }

  const admin = createAdminClient();

  try {
    if (mode === "hybrid") {
      const results = await hybridSearch(admin, workspaceId, query, {
        limit,
        allowedBoxIds: ctx.allowedBoxIds,
      });
      return apiOk({
        query,
        mode: "hybrid",
        limit,
        results: results.map((r) => ({
          note_id: r.noteId,
          title: r.title,
          snippet: r.snippet,
          similarity: r.similarity,
          keyword_score: r.keywordScore,
          combined_score: r.combinedScore,
          match_type: r.matchType,
        })),
      });
    }

    const results = await semanticSearch(admin, workspaceId, query, {
      limit,
      allowedBoxIds: ctx.allowedBoxIds,
    });
    return apiOk({
      query,
      mode: "semantic",
      limit,
      results: results.map((r) => ({
        note_id: r.noteId,
        title: r.title,
        snippet: r.snippet,
        similarity: r.similarity,
      })),
    });
  } catch {
    return E_INTERNAL();
  }
});
