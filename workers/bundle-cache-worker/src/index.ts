/**
 * Cloudflare Worker: context-store-bundle-cache
 *
 * KV-backed cache for context bundle assembly results.
 * Accepts a shared secret for auth, scoped to the app's origin.
 *
 * POST /cache/get  { key: string }         -> cached bundle or 404
 * POST /cache/set  { key: string, value: object, ttl: number } -> stores
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface Env {
  BUNDLE_CACHE: KVNamespace;
  BUNDLE_CACHE_SECRET: string;
  ALLOWED_ORIGIN: string;
}

interface CacheGetRequest {
  key: string;
}

interface CacheSetRequest {
  key: string;
  value: unknown;
  ttl: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Hard upper bound on `expirationTtl` (seconds). 30 days. */
const MAX_TTL = 86400 * 30;

/** Max length in bytes of the serialized cache value. */
const MAX_VALUE_SIZE = 1_000_000; // 1 MB

/** Max length of a cache key string. */
const MAX_KEY_LENGTH = 200;

/**
 * Allowed cache key format. Matches:
 *   bundle:<segment>:<segment>[:<segment>][:overlay]
 * where each segment is [A-Za-z0-9_-]+. The optional trailing `:overlay`
 * suffix is used by the overlay variant introduced in Agent 8's work.
 */
const VALID_KEY = /^bundle:[A-Za-z0-9_\-]+:[A-Za-z0-9_\-]+(:[A-Za-z0-9_\-]+)?(:overlay)?$/;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison. Returns true iff strings are equal.
 * Prevents timing side-channels when comparing bearer tokens.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isValidCacheKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    key.length > 0 &&
    key.length <= MAX_KEY_LENGTH &&
    VALID_KEY.test(key)
  );
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

    // Auth check. Fail fast on missing header, then use a constant-time
    // comparison so we don't leak the secret via response timing.
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401, allowedOrigin);
    }
    const expectedToken = `Bearer ${env.BUNDLE_CACHE_SECRET}`;
    if (!timingSafeEqual(authHeader, expectedToken)) {
      return jsonResponse({ error: "Unauthorized" }, 401, allowedOrigin);
    }

    const url = new URL(request.url);

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, allowedOrigin);
    }

    // ── POST /cache/get ──────────────────────────────────────────────────
    if (url.pathname === "/cache/get") {
      let body: CacheGetRequest;
      try {
        body = (await request.json()) as CacheGetRequest;
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400, allowedOrigin);
      }

      if (!isValidCacheKey(body.key)) {
        return jsonResponse(
          { error: "'key' format invalid" },
          400,
          allowedOrigin,
        );
      }

      const cached = await env.BUNDLE_CACHE.get(body.key, "text");
      if (cached === null) {
        return jsonResponse({ error: "Not found" }, 404, allowedOrigin);
      }

      try {
        const parsed = JSON.parse(cached);
        return jsonResponse({ value: parsed }, 200, allowedOrigin);
      } catch {
        // Stored value isn't valid JSON -- treat as miss
        return jsonResponse({ error: "Not found" }, 404, allowedOrigin);
      }
    }

    // ── POST /cache/set ──────────────────────────────────────────────────
    if (url.pathname === "/cache/set") {
      let body: CacheSetRequest;
      try {
        body = (await request.json()) as CacheSetRequest;
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400, allowedOrigin);
      }

      if (!isValidCacheKey(body.key)) {
        return jsonResponse(
          { error: "'key' format invalid" },
          400,
          allowedOrigin,
        );
      }
      if (body.value === undefined) {
        return jsonResponse(
          { error: "'value' is required" },
          400,
          allowedOrigin,
        );
      }
      if (
        typeof body.ttl !== "number" ||
        !Number.isFinite(body.ttl) ||
        body.ttl <= 0 ||
        body.ttl > MAX_TTL
      ) {
        return jsonResponse(
          { error: `'ttl' must be between 1 and ${MAX_TTL} seconds` },
          400,
          allowedOrigin,
        );
      }

      // Serialize once: we need the byte length to enforce the size cap
      // and we reuse the same string for the KV put call.
      const serialized = JSON.stringify(body.value);
      if (serialized.length > MAX_VALUE_SIZE) {
        return jsonResponse(
          { error: "'value' too large" },
          413,
          allowedOrigin,
        );
      }

      await env.BUNDLE_CACHE.put(body.key, serialized, {
        expirationTtl: body.ttl,
      });

      return jsonResponse({ ok: true }, 200, allowedOrigin);
    }

    return jsonResponse({ error: "Not found" }, 404, allowedOrigin);
  },
} satisfies ExportedHandler<Env>;
