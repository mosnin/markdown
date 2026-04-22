/**
 * Rate limiter for API routes.
 *
 * Implements a sliding window counter per key. Two backends are supported:
 *
 *   1. Upstash Redis (production) — used automatically when either
 *      `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` or the
 *      Vercel-KV-compatible `KV_REST_API_URL` / `KV_REST_API_TOKEN`
 *      env pair is present. Shared across all serverless instances so
 *      counters are globally correct on Vercel production.
 *
 *   2. In-memory Map (local dev / tests) — fallback when no Upstash env
 *      vars are set. Single-process correctness only; sufficient for
 *      `pnpm dev`, `pnpm test`, and any single-instance deployment.
 *
 * The public API (`checkRateLimit`, pre-baked limiters, `RateLimitResult`
 * shape) is stable across backends. Errors from the Upstash client
 * fail OPEN (we allow the request through) — rate limiting is
 * defense-in-depth, not a primary authorization gate, and a transient
 * Redis blip should never break user-facing endpoints.
 *
 * ── Current usage ────────────────────────────────────────────────────────────
 * Applied at trust-sensitive API mutation entry points:
 *   - Proposal creation (POST /api/v1/write_proposals)  — apiWriteLimit per connection
 *   - Generated note creation (POST /api/v1/generated_notes) — apiWriteLimit per connection
 *   - Export/import routes — importExportLimit per connection/user
 *   - MCP write tools — apiWriteLimit per client
 *
 * ── V1 limits ────────────────────────────────────────────────────────────────
 * These are intentionally conservative. Adjust after observing real traffic.
 */

import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Seconds until the current window resets. */
  retryAfter: number;
}

// ── Upstash backend (lazy) ───────────────────────────────────────────────────

let _redisClient: Redis | null | undefined;

/**
 * Return a shared Redis client if Upstash env vars are configured,
 * otherwise null. Initialized on first use so the module is safe to
 * import during build when env vars may not be set.
 */
function _getRedis(): Redis | null {
  if (_redisClient !== undefined) return _redisClient;

  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    _redisClient = null;
    return null;
  }

  _redisClient = new Redis({ url, token });
  return _redisClient;
}

/**
 * Per-(limit, windowSecs) cache of `Ratelimit` instances. All instances
 * share the single Redis client returned by `_getRedis()`.
 */
const _ratelimitCache = new Map<string, Ratelimit>();

function _getRatelimiter(
  limit: number,
  windowSecs: number,
): Ratelimit | null {
  const redis = _getRedis();
  if (!redis) return null;

  const cacheKey = `${limit}:${windowSecs}`;
  const cached = _ratelimitCache.get(cacheKey);
  if (cached) return cached;

  const rl = new Ratelimit({
    redis,
    // Sliding window matches the in-memory implementation's semantics.
    limiter: Ratelimit.slidingWindow(limit, `${windowSecs} s`),
    analytics: false,
    prefix: "ctxs:rl",
  });
  _ratelimitCache.set(cacheKey, rl);
  return rl;
}

// ── In-memory fallback ───────────────────────────────────────────────────────

interface WindowEntry {
  count: number;
  windowStart: number;
}

const _store = new Map<string, WindowEntry>();

/**
 * Sliding window counter backed by a module-local Map. Single-process
 * only — kept intact from the original implementation so local dev and
 * unit tests work without any configuration.
 */
function _checkRateLimitInMemory(
  key: string,
  limit: number,
  windowSecs: number,
): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSecs * 1000;

  const entry = _store.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    // New window
    _store.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  if (entry.count >= limit) {
    const retryAfter = Math.ceil(
      (entry.windowStart + windowMs - now) / 1000,
    );
    return { allowed: false, remaining: 0, retryAfter };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, retryAfter: 0 };
}

// ── Public API ───────────────────────────────────────────────────────────────

let _warnedOnce = false;

/**
 * Check and increment a sliding window rate limit.
 *
 * Uses Upstash Redis when configured (multi-instance safe), otherwise
 * an in-process Map. Fails OPEN on Upstash errors.
 *
 * @param key        — Unique key (e.g. connection_id, ip address)
 * @param limit      — Maximum requests per window
 * @param windowSecs — Window duration in seconds
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSecs: number,
): Promise<RateLimitResult> {
  const rl = _getRatelimiter(limit, windowSecs);
  if (rl) {
    try {
      const res = await rl.limit(key);
      const retryAfter = res.success
        ? 0
        : Math.max(0, Math.ceil((res.reset - Date.now()) / 1000));
      return {
        allowed: res.success,
        remaining: res.remaining,
        retryAfter,
      };
    } catch (err) {
      // Fail open — rate limiting is defense-in-depth, not a primary gate.
      if (!_warnedOnce) {
        _warnedOnce = true;
        console.warn(
          "[rate_limit] Upstash Redis error — failing open:",
          err instanceof Error ? err.message : err,
        );
      }
      return { allowed: true, remaining: limit - 1, retryAfter: 0 };
    }
  }
  return _checkRateLimitInMemory(key, limit, windowSecs);
}

/**
 * Purge expired entries from the in-memory store.
 *
 * No-op when Upstash is the active backend — Redis expires entries
 * automatically via TTL. Kept for API stability and for callers still
 * running against the in-memory fallback.
 */
export function purgeExpiredEntries(windowSecs: number): void {
  if (_getRedis()) return; // Redis TTL handles expiry
  const cutoff = Date.now() - windowSecs * 1000;
  for (const [key, entry] of _store.entries()) {
    if (entry.windowStart < cutoff) {
      _store.delete(key);
    }
  }
}

// ── Pre-configured limiters ───────────────────────────────────────────────────

/** 60 requests per minute for standard API reads. */
export const apiReadLimit = (key: string) => checkRateLimit(key, 60, 60);

/** 20 mutations per minute for write/create API routes. */
export const apiWriteLimit = (key: string) => checkRateLimit(key, 20, 60);

/** 5 import/export initiations per minute. */
export const importExportLimit = (key: string) => checkRateLimit(key, 5, 60);

/** 5 AI operator runs per minute per user. */
export const operatorRunLimit = (key: string) => checkRateLimit(key, 5, 60);
