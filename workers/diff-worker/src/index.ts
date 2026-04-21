/**
 * Cloudflare Worker: context-store-diff
 *
 * Computes prose diffs on the edge, offloading the `diff` library from
 * the Next.js server.
 *
 * POST /diff
 *   Body: { before: string | null, after: string | null, mode?: 'words' | 'lines' }
 *   Returns: { parts: DiffPart[], fallback: boolean }
 */

import { diffWords, diffLines } from "diff";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Env {
  DIFF_WORKER_SECRET: string;
  ALLOWED_ORIGIN: string;
}

interface DiffRequest {
  before: string | null;
  after: string | null;
  mode?: "words" | "lines";
}

interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

interface DiffResponse {
  parts: DiffPart[];
  fallback: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Threshold (bytes) above which we auto-fallback to line-level diff. */
const LARGE_CONTENT_THRESHOLD = 50_000;

/** Hard upper limit on combined input size (bytes) for a single request. */
const MAX_TOTAL_SIZE = 1_000_000; // 1 MB

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison. Returns true iff strings are equal.
 * Always inspects every character of `a` when lengths match, so timing
 * leaks the length but not the content.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  origin: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin),
      });
    }

    // Only POST /diff is accepted
    const url = new URL(request.url);
    if (url.pathname !== "/diff" || request.method !== "POST") {
      return jsonResponse({ error: "Not found" }, 404, allowedOrigin);
    }

    // Auth check. Fail fast on missing header (no token => unauth),
    // then use a constant-time comparison to avoid leaking the secret
    // byte-by-byte via response timing.
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401, allowedOrigin);
    }
    const expectedToken = `Bearer ${env.DIFF_WORKER_SECRET}`;
    if (!timingSafeEqual(authHeader, expectedToken)) {
      return jsonResponse({ error: "Unauthorized" }, 401, allowedOrigin);
    }

    // Parse body
    let body: DiffRequest;
    try {
      body = (await request.json()) as DiffRequest;
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400, allowedOrigin);
    }

    const { before, after, mode } = body;

    // Validate
    if (before !== null && typeof before !== "string") {
      return jsonResponse(
        { error: "'before' must be a string or null" },
        400,
        allowedOrigin,
      );
    }
    if (after !== null && typeof after !== "string") {
      return jsonResponse(
        { error: "'after' must be a string or null" },
        400,
        allowedOrigin,
      );
    }
    if (mode !== undefined && mode !== "words" && mode !== "lines") {
      return jsonResponse(
        { error: "'mode' must be 'words' or 'lines'" },
        400,
        allowedOrigin,
      );
    }

    // Enforce hard upper bound on combined input size BEFORE diffing.
    // Diff algorithms are super-linear in input size, so we cap total
    // bytes to prevent CPU exhaustion / DoS via oversized payloads.
    const beforeLen = (before ?? "").length;
    const afterLen = (after ?? "").length;
    if (beforeLen + afterLen > MAX_TOTAL_SIZE) {
      return jsonResponse({ error: "Input too large" }, 413, allowedOrigin);
    }

    // Compute diff
    const result = computeDiff(before, after, mode);
    return jsonResponse(result, 200, allowedOrigin);
  },
} satisfies ExportedHandler<Env>;

// ─── Core diff logic ────────────────────────────────────────────────────────

function computeDiff(
  before: string | null,
  after: string | null,
  mode?: "words" | "lines",
): DiffResponse {
  if (before === null && after === null) {
    return { parts: [], fallback: false };
  }

  if (before === null) {
    return {
      parts: [{ value: after!, added: true }],
      fallback: false,
    };
  }

  if (after === null) {
    return {
      parts: [{ value: before, removed: true }],
      fallback: false,
    };
  }

  const totalSize = before.length + after.length;
  const shouldFallbackToLines =
    mode === "lines" || (mode !== "words" && totalSize > LARGE_CONTENT_THRESHOLD);

  const changes = shouldFallbackToLines
    ? diffLines(before, after)
    : diffWords(before, after);

  const parts: DiffPart[] = changes.map((c) => {
    const part: DiffPart = { value: c.value };
    if (c.added) part.added = true;
    if (c.removed) part.removed = true;
    return part;
  });

  return {
    parts,
    fallback: mode !== "lines" && totalSize > LARGE_CONTENT_THRESHOLD,
  };
}
