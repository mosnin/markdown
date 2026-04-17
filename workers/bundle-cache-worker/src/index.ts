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

// ─── Helpers ────────────────────────────────────────────────────────────────

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

    // Auth check
    const authHeader = request.headers.get("Authorization");
    const expectedToken = `Bearer ${env.BUNDLE_CACHE_SECRET}`;
    if (!authHeader || authHeader !== expectedToken) {
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

      if (!body.key || typeof body.key !== "string") {
        return jsonResponse(
          { error: "'key' is required and must be a string" },
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

      if (!body.key || typeof body.key !== "string") {
        return jsonResponse(
          { error: "'key' is required and must be a string" },
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
      if (typeof body.ttl !== "number" || body.ttl <= 0) {
        return jsonResponse(
          { error: "'ttl' must be a positive number (seconds)" },
          400,
          allowedOrigin,
        );
      }

      await env.BUNDLE_CACHE.put(body.key, JSON.stringify(body.value), {
        expirationTtl: body.ttl,
      });

      return jsonResponse({ ok: true }, 200, allowedOrigin);
    }

    return jsonResponse({ error: "Not found" }, 404, allowedOrigin);
  },
} satisfies ExportedHandler<Env>;
