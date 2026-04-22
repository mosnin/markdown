import { Exa } from "exa-js";

export interface ExaSearchOptions {
  numResults?: number;
  searchType?: "neural" | "keyword" | "auto";
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
}

export interface ExaSearchResult {
  url: string;
  title: string | null;
  text: string;
  published_date: string | null;
  score: number;
  highlights: string[];
}

export interface ExaSearchResponse {
  results: ExaSearchResult[];
  estimated_cost_cents: number;
}

const DEFAULT_NUM_RESULTS = 10;
const MAX_NUM_RESULTS = 25;
const TEXT_MAX_CHARS = 1000;

// Shape we expect back from exa-js — the SDK types use different property
// names across versions, so we coerce defensively rather than depend on them.
interface RawExaResultItem {
  url?: unknown;
  title?: unknown;
  text?: unknown;
  publishedDate?: unknown;
  score?: unknown;
  highlights?: unknown;
}

interface RawExaResponse {
  results?: RawExaResultItem[];
}

export async function exaSearch(
  query: string,
  options: ExaSearchOptions
): Promise<ExaSearchResponse> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error("EXA_API_KEY not configured");
  }

  const numResults = clampNumResults(options.numResults);
  const type = options.searchType ?? "auto";

  const exa = new Exa(apiKey);
  // The SDK's option typings vary across versions; we hand it the raw shape
  // and coerce the response ourselves.
  const exaOptions = {
    numResults,
    type,
    includeDomains: options.includeDomains,
    excludeDomains: options.excludeDomains,
    startPublishedDate: options.startPublishedDate,
    endPublishedDate: options.endPublishedDate,
    text: { maxCharacters: TEXT_MAX_CHARS },
    highlights: true,
  };
  const raw = (await (
    exa.searchAndContents as unknown as (
      q: string,
      o: typeof exaOptions
    ) => Promise<RawExaResponse>
  )(query, exaOptions)) as RawExaResponse;

  const results: ExaSearchResult[] = Array.isArray(raw?.results)
    ? raw.results.map(normaliseResult)
    : [];

  return {
    results,
    // 1¢ per returned result — crude placeholder until we wire Exa's per-call
    // pricing. Counts only materialised results so failures don't bill.
    estimated_cost_cents: results.length,
  };
}

function clampNumResults(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_NUM_RESULTS;
  }
  const floored = Math.floor(value);
  if (floored < 1) return 1;
  if (floored > MAX_NUM_RESULTS) return MAX_NUM_RESULTS;
  return floored;
}

function normaliseResult(item: RawExaResultItem): ExaSearchResult {
  return {
    url: typeof item.url === "string" ? item.url : "",
    title: typeof item.title === "string" ? item.title : null,
    text: typeof item.text === "string" ? item.text : "",
    published_date:
      typeof item.publishedDate === "string" ? item.publishedDate : null,
    score: typeof item.score === "number" ? item.score : 0,
    highlights: Array.isArray(item.highlights)
      ? item.highlights.filter((h): h is string => typeof h === "string")
      : [],
  };
}
