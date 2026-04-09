/**
 * Lightweight in-process rate limiter.
 *
 * Implements a sliding window counter per key using an in-memory Map.
 *
 * ── Production note ──────────────────────────────────────────────────────────
 * This implementation is suitable for single-process deployments (local dev,
 * single Vercel instance). In a multi-instance deployment (standard Vercel
 * production), each serverless function instance has its own memory — counters
 * are NOT shared across instances.
 *
 * For production rate limiting across multiple instances, replace the backing
 * store with Vercel KV (Upstash Redis) or a Supabase function-level table.
 * The RateLimiter interface and checkRateLimit() signature are intentionally
 * stable so the store can be swapped without changing callers.
 *
 * ── Current usage ────────────────────────────────────────────────────────────
 * Applied at trust-sensitive API entry points:
 *   - Connection token auth routes (all /api/v1/ routes via getConnectionContext)
 *   - Import initiation (POST /api/v1/import_package)
 *   - Export initiation (POST /api/v1/export_*)
 *   - Proposal creation (POST /api/v1/write_proposals)
 *   - Generated note creation (POST /api/v1/generated_notes)
 *
 * ── V1 limits ────────────────────────────────────────────────────────────────
 * These are intentionally conservative. Adjust after observing real traffic.
 */

interface WindowEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, WindowEntry>();

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Seconds until the current window resets. */
  retryAfter: number;
}

/**
 * Check and increment a sliding window rate limit.
 *
 * @param key        — Unique key (e.g. connection_id, ip address)
 * @param limit      — Maximum requests per window
 * @param windowSecs — Window duration in seconds
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowSecs: number
): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSecs * 1000;

  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    // New window
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  if (entry.count >= limit) {
    const retryAfter = Math.ceil(
      (entry.windowStart + windowMs - now) / 1000
    );
    return { allowed: false, remaining: 0, retryAfter };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, retryAfter: 0 };
}

/**
 * Purge expired entries from the in-memory store.
 * Call periodically if long-running (not necessary for short-lived serverless).
 */
export function purgeExpiredEntries(windowSecs: number): void {
  const cutoff = Date.now() - windowSecs * 1000;
  for (const [key, entry] of store.entries()) {
    if (entry.windowStart < cutoff) {
      store.delete(key);
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
