import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-API-key sliding-window rate limiter for the Workspace Operator
 * REST surface (`POST /api/operator/runs`, `GET /api/operator/runs`).
 *
 * ─── Why sliding window over token bucket ────────────────────────────────────
 *
 * A token bucket needs persistent counter rows that we increment-then-read
 * inside a single transaction or via an RPC, otherwise two parallel
 * requests can both pass the check before either decrements the bucket.
 * That race is real on a leaked `wopr_` key being abused from multiple
 * machines at once — exactly the threat model this ticket exists for.
 *
 * A sliding window over an event log avoids the race by being purely
 * additive: each allowed request appends a row, and "did we exceed N in
 * the last W seconds" is a `count(*) WHERE created_at > now() - W`. Two
 * parallel requests both write a row; the next request sees both. There
 * is no shared counter to corrupt.
 *
 * The cost is one INSERT per allowed request and two COUNTs per check
 * (burst + sustained). The table is pruned lazily to >1 hour old rows on
 * each check, so steady-state size is bounded by `keys × max(sustained
 * limit) ≈ 300 rows/key`. That's small enough to never need partitioning.
 *
 * ─── Why DB-backed instead of in-memory ─────────────────────────────────────
 *
 * Vercel / Modal route handlers are stateless and can be load-balanced
 * across many instances; an in-memory bucket only enforces the limit
 * per-instance, multiplying the effective limit by the fleet size. The
 * leaked-key threat sees that as "burst limit × N instances" — useless.
 * Postgres is the only shared coordination point we have, so we use it.
 *
 * ─── Why a separate 429 distinct from quota's 403 ────────────────────────────
 *
 * The monthly quota uses 429 today (see workspace_operator_quota_service);
 * we return 429 for rate-limit hits as well but with a distinct
 * `error: "rate_limit_exceeded"` envelope plus a `Retry-After` header so
 * clients can distinguish "back off for a few seconds" from "wait until
 * next month". This service produces only the inputs to that envelope —
 * the route layer renders the Response with the header attached.
 *
 * NOTE: the task spec describes the quota response as a 403; in this
 * codebase the quota response is actually a 429 with `quota_exceeded`,
 * so the distinction we ship is *error code + Retry-After* rather than
 * status code. That preserves the spec's intent ("clients can tell the
 * two cases apart") without diverging the existing quota route.
 */

// ─── Public surface ─────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  /**
   * Seconds the caller should wait before retrying. Always present on a
   * deny; omitted on allow because callers shouldn't conditionally read it.
   */
  retryAfterSeconds?: number;
  /** Remaining requests in the 60-second burst window after this check. */
  remainingMinute: number;
  /** Remaining requests in the 3600-second sustained window after this check. */
  remainingHour: number;
}

export const BURST_LIMIT_PER_MINUTE = 30;
export const SUSTAINED_LIMIT_PER_HOUR = 300;

const BURST_WINDOW_SECONDS = 60;
const SUSTAINED_WINDOW_SECONDS = 3600;

const RATE_LIMIT_TABLE = "operator_api_rate_limit_events";
const PRUNE_RPC = "prune_operator_api_rate_limit_events";

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * Decide whether `apiKeyId` may make one more request right now.
 *
 *  * Counts events in the burst (60s) and sustained (3600s) windows.
 *  * If either limit is reached, returns `allowed: false` with the
 *    smaller window's remaining seconds as `retryAfterSeconds` (we
 *    surface the *sooner* recovery so clients aren't told to wait
 *    longer than necessary).
 *  * If both limits have headroom, inserts an event row (which counts
 *    against future checks) and returns the post-insert remaining
 *    counts.
 *  * Always issues the lazy prune so the table stays bounded.
 *
 * The function never throws on infra errors. A failed COUNT is treated
 * as "allow" — rate limiting is a guardrail, not an availability gate.
 * A failed INSERT is logged but does not roll the decision back; the
 * worst case is one extra request slips through, which the next check
 * will see and account for.
 *
 * ─── ACCEPTED RISK: check-then-insert TOCTOU (security review #2) ────────
 *
 * The COUNT and INSERT are not transactional. Under extreme concurrent
 * load on a single key, N requests can all observe count < limit and all
 * insert, briefly exceeding the limit by up to N-1. The next request sees
 * every one of those rows and is correctly blocked, so the overshoot is
 * bounded (not compounding) and the window self-heals within one
 * evaluation. Product accepted this vs. the complexity of an RPC/advisory
 * lock: the threat model is credential abuse (sustained flooding), not
 * perfectly-coordinated bursts, and the bound overshoot (~fleet size) is
 * small relative to the sustained-hour limit. Revisit if we ever see a
 * leaked-key abuse case where the burst window is being gamed with
 * perfectly-timed parallel requests.
 */
export async function checkApiRateLimit(
  supabase: SupabaseClient,
  apiKeyId: string,
): Promise<RateLimitResult> {
  const now = Date.now();
  const burstSince = new Date(now - BURST_WINDOW_SECONDS * 1000).toISOString();
  const sustainedSince = new Date(
    now - SUSTAINED_WINDOW_SECONDS * 1000,
  ).toISOString();

  // Lazy prune. We don't await failure-handling here — if it errors,
  // the table just keeps a few extra rows for an extra minute.
  void pruneOldEvents(supabase, apiKeyId);

  const [burstCount, sustainedCount] = await Promise.all([
    countSince(supabase, apiKeyId, burstSince),
    countSince(supabase, apiKeyId, sustainedSince),
  ]);

  // Burst limit hit?
  if (burstCount >= BURST_LIMIT_PER_MINUTE) {
    const retry = await secondsUntilOldestExpires(
      supabase,
      apiKeyId,
      burstSince,
      BURST_WINDOW_SECONDS,
      now,
    );
    return {
      allowed: false,
      retryAfterSeconds: retry,
      remainingMinute: 0,
      remainingHour: Math.max(0, SUSTAINED_LIMIT_PER_HOUR - sustainedCount),
    };
  }

  // Sustained limit hit?
  if (sustainedCount >= SUSTAINED_LIMIT_PER_HOUR) {
    const retry = await secondsUntilOldestExpires(
      supabase,
      apiKeyId,
      sustainedSince,
      SUSTAINED_WINDOW_SECONDS,
      now,
    );
    return {
      allowed: false,
      retryAfterSeconds: retry,
      remainingMinute: Math.max(0, BURST_LIMIT_PER_MINUTE - burstCount),
      remainingHour: 0,
    };
  }

  // Both windows have headroom — record this request and return.
  await recordEvent(supabase, apiKeyId);

  return {
    allowed: true,
    // After the just-inserted row, both counters tick down by one.
    remainingMinute: Math.max(0, BURST_LIMIT_PER_MINUTE - burstCount - 1),
    remainingHour: Math.max(0, SUSTAINED_LIMIT_PER_HOUR - sustainedCount - 1),
  };
}

// ─── Internals ──────────────────────────────────────────────────────────────

async function countSince(
  supabase: SupabaseClient,
  apiKeyId: string,
  sinceIso: string,
): Promise<number> {
  try {
    const { count, error } = await supabase
      .from(RATE_LIMIT_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("api_key_id", apiKeyId)
      .gt("created_at", sinceIso);
    if (error) {
      console.warn("[operator_rate_limit] count failed; allowing", error);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    console.warn("[operator_rate_limit] count threw; allowing", err);
    return 0;
  }
}

async function recordEvent(
  supabase: SupabaseClient,
  apiKeyId: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from(RATE_LIMIT_TABLE)
      .insert({ api_key_id: apiKeyId });
    if (error) {
      console.warn("[operator_rate_limit] insert failed", error);
    }
  } catch (err) {
    console.warn("[operator_rate_limit] insert threw", err);
  }
}

async function pruneOldEvents(
  supabase: SupabaseClient,
  apiKeyId: string,
): Promise<void> {
  try {
    const { error } = await supabase.rpc(PRUNE_RPC, {
      api_key_id_in: apiKeyId,
      older_than_seconds: SUSTAINED_WINDOW_SECONDS,
    });
    if (error) {
      console.warn("[operator_rate_limit] prune failed", error);
    }
  } catch (err) {
    console.warn("[operator_rate_limit] prune threw", err);
  }
}

/**
 * Compute how many seconds the caller should wait before the oldest row
 * inside the relevant window ages out and frees up a slot.
 *
 * If we can't read the oldest row (network blip, race) we fall back to
 * the full window length — overestimating retry time is safe, it just
 * makes well-behaved clients wait a bit longer than strictly needed.
 */
async function secondsUntilOldestExpires(
  supabase: SupabaseClient,
  apiKeyId: string,
  sinceIso: string,
  windowSeconds: number,
  nowMs: number,
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from(RATE_LIMIT_TABLE)
      .select("created_at")
      .eq("api_key_id", apiKeyId)
      .gt("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error || !data || data.length === 0) {
      return windowSeconds;
    }
    const oldestIso = (data[0] as { created_at: string }).created_at;
    const oldestMs = Date.parse(oldestIso);
    if (!Number.isFinite(oldestMs)) return windowSeconds;
    const expiresMs = oldestMs + windowSeconds * 1000;
    // Round UP so we never tell a client "0 seconds" when 0.4s remains.
    const seconds = Math.max(1, Math.ceil((expiresMs - nowMs) / 1000));
    return seconds;
  } catch {
    return windowSeconds;
  }
}
