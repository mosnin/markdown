import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hybridSearch } from "@/server/services/embedding_service";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

/**
 * POST /api/agent/tools/search
 *
 * Internal endpoint invoked by the Workspace Operator (Modal Python agent).
 * Runs hybrid (semantic + keyword) search scoped to the envelope's workspace
 * and branch. Intentionally not exposed via OAuth — this is process-to-process
 * traffic authenticated by `WORKSPACE_OPERATOR_SHARED_SECRET`.
 *
 * Body: { query: string, limit?: number }
 * Returns: { results: [{ note_id, title, snippet, similarity, keyword_score,
 *           combined_score, match_type }] }
 */
export async function POST(request: NextRequest) {
  const auth = verifyAgentRequest(request);
  if (!auth.ok) {
    switch (auth.failure.kind) {
      case "feature_disabled":
        return apiError("feature_disabled", "Workspace Operator is not enabled", 404);
      case "missing_secret":
        return apiError("server_misconfigured", "Shared secret is not configured", 500);
      case "invalid_secret":
        return apiError("unauthorized", "Invalid shared secret", 401);
      case "missing_envelope":
        return E_BAD_REQUEST(`Missing required header: ${auth.failure.field}`);
      case "invalid_envelope":
        return E_BAD_REQUEST(
          `Invalid ${auth.failure.field}: ${auth.failure.reason}`
        );
    }
  }
  const { ctx } = auth;

  let body: { query?: string; limit?: number };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { query, limit: rawLimit } = body;
  if (typeof query !== "string" || !query.trim()) {
    return E_BAD_REQUEST("query is required and must be a non-empty string");
  }

  const MAX_LIMIT = 25;
  const DEFAULT_LIMIT = 10;
  const limit = Math.min(
    Math.max(1, Number.isInteger(rawLimit) ? (rawLimit as number) : DEFAULT_LIMIT),
    MAX_LIMIT
  );

  const admin = createAdminClient();

  try {
    const results = await hybridSearch(admin, ctx.workspaceId, query, {
      limit,
      branchId: ctx.branchId,
    });

    return apiOk({
      run_id: ctx.runId,
      query,
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
  } catch (err) {
    console.error("[agent_tools_search] hybrid search failed", err);
    return E_INTERNAL();
  }
}
