import { type NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

/**
 * POST /api/agent/tools/web_search
 *
 * Internal endpoint invoked by the Workspace Operator. Performs a
 * web search via Tavily on behalf of the agent and returns a list of
 * result snippets the agent can then `web_fetch` for full content.
 *
 * Tavily is configured via the `TAVILY_API_KEY` env var (server-only).
 * The key never leaves this process — the agent calls this endpoint
 * under the shared-secret envelope like every other tool.
 *
 * Body: { query: string, max_results?: number, include_answer?: boolean }
 * Returns: { query, answer, results: [{title, url, content, score}] }
 */

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_CAP = 10;
const FETCH_TIMEOUT_MS = 15_000;
const TAVILY_ENDPOINT = "https://api.tavily.com/search";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  query: string;
  answer?: string | null;
  results: TavilyResult[];
}

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

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return apiError(
      "server_misconfigured",
      "TAVILY_API_KEY is not configured",
      500
    );
  }

  let body: {
    query?: string;
    max_results?: number;
    include_answer?: boolean;
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

  const maxResults = Math.max(
    1,
    Math.min(
      MAX_RESULTS_CAP,
      typeof body.max_results === "number" && Number.isFinite(body.max_results)
        ? Math.floor(body.max_results)
        : DEFAULT_MAX_RESULTS
    )
  );
  const includeAnswer = body.include_answer !== false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_answer: includeAnswer,
        search_depth: "basic",
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    return apiError("search_failed", `Tavily request failed: ${message}`, 502);
  }
  clearTimeout(timer);

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return apiError(
      "search_failed",
      `Tavily returned ${response.status}: ${detail.slice(0, 500)}`,
      502
    );
  }

  let data: TavilyResponse;
  try {
    data = (await response.json()) as TavilyResponse;
  } catch {
    return apiError("search_failed", "Tavily response was not valid JSON", 502);
  }

  const results = Array.isArray(data.results)
    ? data.results.slice(0, maxResults).map((r) => ({
        title: String(r.title ?? ""),
        url: String(r.url ?? ""),
        content: String(r.content ?? ""),
        score: typeof r.score === "number" ? r.score : 0,
      }))
    : [];

  return apiOk({
    run_id: ctx.runId,
    query,
    answer: data.answer ?? null,
    results,
  });
}
