import { type NextRequest } from "next/server";
import { apiOk, apiError, E_BAD_REQUEST } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exaSearch,
  type ExaSearchOptions,
} from "@/server/services/exa_search_service";
import { enforceWebBudget } from "@/server/services/web_budget_service";
import { recordWebToolUsage } from "@/server/repositories/web_tool_usage_repository";
import { createCitation } from "@/server/repositories/web_citation_repository";
import { deepSearchLimit } from "@/lib/api/rate_limit";

/**
 * POST /api/agent/tools/deep_search
 *
 * Exa-backed neural web search. Gated by the workspace web-tool budget
 * and a per-workspace sliding-window rate limit; every result is logged
 * as a `web_citations` row for inline source attribution.
 *
 * operator_run_id is intentionally null for Phase 5C — the run_id header
 * is a string handle, not an FK. A later phase will resolve it through
 * workspace_operator_runs before persisting.
 */

const DEFAULT_NUM_RESULTS = 10;
const MAX_NUM_RESULTS = 25;
const VALID_SEARCH_TYPES = new Set(["neural", "keyword", "auto"]);

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

  let body: {
    query?: unknown;
    num_results?: unknown;
    search_type?: unknown;
    include_domains?: unknown;
    exclude_domains?: unknown;
    start_published_date?: unknown;
    end_published_date?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return E_BAD_REQUEST("query is required and must be a non-empty string");
  }

  const numResults = clampNumResults(body.num_results);

  let searchType: ExaSearchOptions["searchType"] | undefined;
  if (typeof body.search_type === "string") {
    if (!VALID_SEARCH_TYPES.has(body.search_type)) {
      return E_BAD_REQUEST(
        "search_type must be one of: neural, keyword, auto"
      );
    }
    searchType = body.search_type as ExaSearchOptions["searchType"];
  }

  const includeDomains = asStringArray(body.include_domains);
  const excludeDomains = asStringArray(body.exclude_domains);
  const startPublishedDate =
    typeof body.start_published_date === "string"
      ? body.start_published_date
      : undefined;
  const endPublishedDate =
    typeof body.end_published_date === "string"
      ? body.end_published_date
      : undefined;

  const supabase = createAdminClient();

  const rl = await deepSearchLimit(ctx.workspaceId);
  if (!rl.allowed) {
    return apiError(
      "rate_limited",
      `Too many deep_search requests. Retry after ${rl.retryAfter} seconds.`,
      429
    );
  }

  // Pre-call budget gate uses the requested result count as the cost
  // estimate (1¢ per result). The actual cost recorded post-call matches
  // the number of results materialised.
  const budgetBlock = await enforceWebBudget(
    supabase,
    ctx.workspaceId,
    numResults
  );
  if (budgetBlock) return budgetBlock;

  let searchResponse;
  try {
    searchResponse = await exaSearch(query, {
      numResults,
      searchType,
      includeDomains,
      excludeDomains,
      startPublishedDate,
      endPublishedDate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return apiError("search_failed", `Exa request failed: ${message}`, 502);
  }

  const { results, estimated_cost_cents } = searchResponse;

  try {
    await recordWebToolUsage(supabase, {
      workspace_id: ctx.workspaceId,
      user_id: ctx.userId,
      tool_name: "exa_search",
      units: results.length,
      cost_cents: estimated_cost_cents,
      operator_run_id: null,
      metadata: { query },
    });
  } catch (err) {
    console.warn(
      "[deep_search] recordWebToolUsage failed:",
      err instanceof Error ? err.message : err
    );
  }

  // Best-effort citation writes — one bad row should not fail the caller.
  await Promise.all(
    results.map((r) =>
      createCitation(supabase, {
        workspace_id: ctx.workspaceId,
        operator_run_id: null,
        source_type: "exa",
        url: r.url,
        title: r.title,
        excerpt: r.text.slice(0, 200),
      }).catch((err) => {
        console.warn(
          "[deep_search] createCitation failed:",
          err instanceof Error ? err.message : err
        );
      })
    )
  );

  return apiOk({
    run_id: ctx.runId,
    query,
    results,
  });
}

function clampNumResults(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_NUM_RESULTS;
  }
  const floored = Math.floor(raw);
  if (floored < 1) return 1;
  if (floored > MAX_NUM_RESULTS) return MAX_NUM_RESULTS;
  return floored;
}

function asStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((v): v is string => typeof v === "string" && v.length > 0);
  return out.length > 0 ? out : undefined;
}
