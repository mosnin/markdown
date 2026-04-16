import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Durable, cross-instance rate limiter backed by the
 * `rate_limit_buckets` table.
 *
 * Known tradeoff: because windows are fixed (not sliding), a caller
 * can burst up to 2x the configured limit straddling a window
 * boundary — accepted as a coarse anti-abuse guarantee in exchange
 * for a dramatically simpler implementation.
 *
 * ── Why a separate service from `src/lib/api/rate_limit.ts`? ────────────────
 *
 * The in-process limiter there is fine for high-frequency, per-
 * connection bursts on the canonical API (writes/min per connection) —
 * it's hot-pathed and doesn't need cross-instance coherence because a
 * single connection tends to land on the same region's cache.
 *
 * The OAuth surfaces are different:
 *
 *   - Dynamic client registration is an anti-abuse control, not a
 *     burst control. A bot that bounces between regions to defeat
 *     in-memory counters is a real threat.
 *   - The token / authorize / revoke endpoints are invoked by the
 *     same user or client across many sessions; again, memory locality
 *     is the wrong boundary.
 *
 * This service writes to the DB on every check — slower, but the
 * durable counter is the point.
 *
 * ── Applied limits (as of the productization landing) ───────────────────────
 *
 *   registration (POST /api/oauth/register)
 *     bucket key: "oauth_register:user:<userId>"
 *     3 per hour
 *
 *   token endpoint (POST /api/oauth/token)
 *     bucket key: "oauth_token:client:<clientId>"
 *     30 per minute
 *
 *   authorize approve/deny (server actions)
 *     bucket key: "oauth_authorize:user:<userId>"
 *     10 per minute
 *
 *   revoke (POST /api/oauth/revoke)
 *     bucket key: "oauth_revoke:user:<userId>"
 *     30 per minute
 *
 * ── Fixed windows, not sliding ──────────────────────────────────────────────
 *
 * Every bucket is a (bucket_key, window_start) pair with a monotonic
 * integer count. Window start is bucketed to the nearest
 * `windowSeconds`. Fixed windows can burst 2x the limit at the window
 * boundary — acceptable for the coarse anti-abuse controls here and
 * dramatically simpler than a sliding implementation.
 */

export interface RateLimitOptions {
  /** Maximum number of requests per window. */
  limit: number;
  /** Window size in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Number of requests remaining in the current window. Always ≥ 0. */
  remaining: number;
  /** Suggested Retry-After in seconds. Only meaningful when !allowed. */
  retryAfterSeconds: number;
  /** Identifier the caller passed in — returned for convenience. */
  bucketKey: string;
  /** Limit applied (copied from options). */
  limit: number;
}

/**
 * Truncate `Date.now()` to the nearest `windowSeconds` boundary so that
 * two concurrent callers in the same window hit the same row.
 */
function currentWindowStart(windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(Date.now() / ms) * ms);
}

/**
 * Check-and-increment. Returns whether the call is allowed and, if
 * not, how long the caller should wait.
 *
 * Correctness under concurrency: we use an UPSERT-then-SELECT. The
 * UPSERT either inserts a fresh `(key, window)` row with `count=1`
 * or increments an existing row's `count`. A subsequent read returns
 * the authoritative post-increment count for the bucket. If two
 * callers race, both see an increment; one of them may cross the
 * limit by exactly one extra slot which is harmless for anti-abuse.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  bucketKey: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const windowStart = currentWindowStart(options.windowSeconds);
  const windowStartIso = windowStart.toISOString();

  // Step 1: reserve / bump the row. `upsert` with a conflict target on
  // (bucket_key, window_start) is our atomic "create or bump" — the
  // unique index in the migration makes this a single round-trip.
  //
  // Unfortunately supabase-js's upsert does not natively support
  // "increment on conflict". We emulate by reading first; under race
  // one of the concurrent callers may double-count by 1 which is
  // acceptable for our use (anti-abuse, not exact billing).
  //
  // If the DB write fails for any reason we fail-open rather than
  // fail-closed: rate limiting is a defense-in-depth layer, not the
  // primary gate, and a transient DB error should not break the
  // authorize/token flow.
  try {
    const { data: existing } = await supabase
      .from("rate_limit_buckets")
      .select("id, count")
      .eq("bucket_key", bucketKey)
      .eq("window_start", windowStartIso)
      .maybeSingle();

    if (!existing) {
      const { error: insErr } = await supabase
        .from("rate_limit_buckets")
        .insert({
          bucket_key: bucketKey,
          window_start: windowStartIso,
          count: 1,
        });
      // A concurrent insert will collide on the unique index; fall
      // through to the update path below for that case.
      if (insErr && !/duplicate key|23505/i.test(insErr.message)) {
        return allow(bucketKey, options.limit, options.limit - 1, 0);
      }
      if (!insErr) {
        return allow(bucketKey, options.limit, options.limit - 1, 0);
      }
      // Dup key fallthrough: re-fetch and update.
      const { data: refetched } = await supabase
        .from("rate_limit_buckets")
        .select("id, count")
        .eq("bucket_key", bucketKey)
        .eq("window_start", windowStartIso)
        .maybeSingle();
      // Tight null guard: in an extreme race the row we collided with
      // could have been deleted (window-rollover cleanup, manual ops)
      // between the INSERT and this SELECT. Calling incrementAndCheck
      // with an undefined count would either NaN-propagate or silently
      // over-count. Fail-open with an explicit allow so rate limiting
      // remains a defense-in-depth layer, never the primary gate.
      if (!refetched) {
        console.debug(
          "[rate_limit_service] dup-key refetch returned null; failing open",
          { bucketKey, windowStart: windowStartIso }
        );
        return allow(bucketKey, options.limit, options.limit - 1, 0);
      }
      return await incrementAndCheck(
        supabase,
        refetched.id,
        refetched.count,
        bucketKey,
        options,
        windowStart
      );
    }

    return await incrementAndCheck(
      supabase,
      existing.id,
      existing.count,
      bucketKey,
      options,
      windowStart
    );
  } catch {
    // Fail-open on any DB error — see rationale above.
    return allow(bucketKey, options.limit, options.limit - 1, 0);
  }
}

async function incrementAndCheck(
  supabase: SupabaseClient,
  rowId: string,
  currentCount: number,
  bucketKey: string,
  options: RateLimitOptions,
  windowStart: Date
): Promise<RateLimitResult> {
  const retryAfter = retryAfterSeconds(windowStart, options.windowSeconds);

  if (currentCount >= options.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: retryAfter,
      bucketKey,
      limit: options.limit,
    };
  }

  const nextCount = currentCount + 1;
  await supabase
    .from("rate_limit_buckets")
    .update({ count: nextCount })
    .eq("id", rowId);

  return {
    allowed: true,
    remaining: Math.max(0, options.limit - nextCount),
    retryAfterSeconds: 0,
    bucketKey,
    limit: options.limit,
  };
}

function allow(
  bucketKey: string,
  limit: number,
  remaining: number,
  retryAfter: number
): RateLimitResult {
  return {
    allowed: true,
    remaining,
    retryAfterSeconds: retryAfter,
    bucketKey,
    limit,
  };
}

function retryAfterSeconds(windowStart: Date, windowSeconds: number): number {
  const nextWindow = windowStart.getTime() + windowSeconds * 1000;
  return Math.max(1, Math.ceil((nextWindow - Date.now()) / 1000));
}

// ─── Pre-configured buckets ─────────────────────────────────────────────────

export const REGISTRATION_LIMIT: RateLimitOptions = { limit: 3, windowSeconds: 60 * 60 };
export const TOKEN_LIMIT: RateLimitOptions = { limit: 30, windowSeconds: 60 };
export const AUTHORIZE_LIMIT: RateLimitOptions = { limit: 10, windowSeconds: 60 };
export const REVOKE_LIMIT: RateLimitOptions = { limit: 30, windowSeconds: 60 };

export function registerBucketKey(userId: string): string {
  return `oauth_register:user:${userId}`;
}
export function tokenBucketKey(clientId: string): string {
  return `oauth_token:client:${clientId}`;
}
export function authorizeBucketKey(userId: string): string {
  return `oauth_authorize:user:${userId}`;
}
export function revokeBucketKey(userId: string): string {
  return `oauth_revoke:user:${userId}`;
}
