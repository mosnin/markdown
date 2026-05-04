import { createHash, randomBytes } from "node:crypto";
import { type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

/**
 * Pull-token service.
 *
 * A pull-token is a short-lived URL token used by the "Send to AI" feature.
 * The issuer (a workspace user) creates a token that points at a single
 * object — today only a `note` — and shares the resulting URL with an
 * external AI agent. The agent fetches the URL, the route handler redeems
 * the token, and a content-negotiated context bundle is returned.
 *
 * Security model:
 *   * Tokens are 32 random bytes, base64url-encoded, prefixed with
 *     `pgl_pull_`. We store only the SHA-256 hash; the raw token is
 *     surfaced to the issuer ONCE at creation time.
 *   * `redeem_pull_token` is a SQL function that runs SECURITY DEFINER
 *     to atomically validate + slide the expiry + bump the redemption
 *     count. Application code must always go through it.
 *   * RLS limits direct row access to the issuing user. All admin work
 *     (issue, redeem, audit) goes through the service-role client.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PullTokenObjectType =
  | "note"
  | "box"
  | "skill"
  | "agent"
  | "bundle";

const OBJECT_TYPES = new Set<PullTokenObjectType>([
  "note",
  "box",
  "skill",
  "agent",
  "bundle",
]);

export interface IssuePullTokenInput {
  workspaceId: string;
  userId: string;
  objectType: PullTokenObjectType;
  objectId: string;
  /** Hard cap window. Must be 60..86400 seconds (1 minute .. 24 hours). */
  ttlSeconds: number;
  writeCapable: boolean;
  /** 0..86400 seconds. 0 disables sliding-window renewal. Default 0. */
  slidingWindowSeconds?: number;
  /** 1..10000. Default 100. */
  maxRedemptions?: number;
}

export interface PullTokenSummary {
  id: string;
  /** First 16 chars of the issued token, e.g. "pgl_pull_AbCd…". */
  tokenPrefix: string;
  objectType: PullTokenObjectType;
  objectId: string;
  /** Sliding-window expiry, ISO-8601. */
  expiresAt: string;
  /** Hard cap — the absolute latest the token can survive, ISO-8601. */
  hardCapAt: string;
  /** Sliding window length in seconds. */
  slidingWindowSeconds: number;
  /** True when the issued capability includes write-proposal authoring. */
  writeCapable: boolean;
  redemptionCount: number;
  maxRedemptions: number;
  lastRedeemedAt: string | null;
  /** Best-effort capture from the most recent redemption. */
  lastUserAgent: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface RedeemResult {
  workspaceId: string;
  userId: string;
  objectType: PullTokenObjectType;
  objectId: string;
  writeCapable: boolean;
  /** ISO 8601 timestamp of the (possibly extended) expiry. */
  newExpiresAt: string;
  /** Floor of seconds until the token expires, never negative. */
  expiresInSeconds: number;
}

/**
 * Aggregation used by the admin perf-dashboard tile.
 * `windowMs` defaults to 24 h on the calling site.
 */
export interface PullTokenActivitySummary {
  /** Bundle reads in the window — successful 200 responses. */
  reads: number;
  /** Write-proposal posts in the window. */
  writes: number;
  /** Currently active (not revoked, not expired) tokens at query time. */
  activeTokens: number;
  /** Failed pulls in the window — invalid/expired/revoked attempts. */
  invalidAttempts: number;
  /** ISO-8601 — used for the "as of" caption on the tile. */
  generatedAt: string;
  /** Window duration the counts cover, ms. */
  windowMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Public token prefix — clients should never strip this. */
export const PULL_TOKEN_PREFIX = "pgl_pull_";

/** Length of the random secret in bytes (before base64url encoding). */
const SECRET_BYTES = 32;

/** Number of leading characters of the full token surfaced for display. */
const TOKEN_PREFIX_DISPLAY_LEN = 16;

const TTL_MIN_SECONDS = 60;
const TTL_MAX_SECONDS = 86_400;
const SLIDING_MAX_SECONDS = 86_400;
const REDEMPTIONS_MIN = 1;
const REDEMPTIONS_MAX = 10_000;

/**
 * Re-export the canonical pull-token audit event types so the audit
 * page filter chip and per-row badge stay in sync with the writer
 * side. Both events live in `audit_events.event_type`.
 */
export const PULL_TOKEN_AUDIT_EVENT_TYPES = [
  "bundle.pulled",
  "bundle.pulled_invalid",
] as const;

export type PullTokenAuditEventType =
  (typeof PULL_TOKEN_AUDIT_EVENT_TYPES)[number];

// ─── Token primitives ─────────────────────────────────────────────────────────

/** Generate a new opaque pull-token of the form `pgl_pull_<base64url>`. */
function generateToken(): string {
  return `${PULL_TOKEN_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`;
}

/** SHA-256 hex of the full token string. */
export function hashPullToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ─── Row mapping ──────────────────────────────────────────────────────────────

interface PullTokenRow {
  id: string;
  workspace_id: string;
  user_id: string;
  token_hash: string;
  token_prefix: string;
  object_type: PullTokenObjectType;
  object_id: string;
  write_capable: boolean;
  expires_at: string;
  hard_cap_at: string;
  sliding_window_seconds: number;
  max_redemptions: number;
  redemption_count: number;
  last_redeemed_at: string | null;
  last_user_agent: string | null;
  revoked_at: string | null;
  created_at: string;
}

function rowToSummary(row: PullTokenRow): PullTokenSummary {
  return {
    id: row.id,
    tokenPrefix: row.token_prefix,
    objectType: row.object_type,
    objectId: row.object_id,
    expiresAt: row.expires_at,
    hardCapAt: row.hard_cap_at,
    slidingWindowSeconds: row.sliding_window_seconds,
    writeCapable: row.write_capable,
    redemptionCount: row.redemption_count,
    maxRedemptions: row.max_redemptions,
    lastRedeemedAt: row.last_redeemed_at,
    lastUserAgent: row.last_user_agent,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min;
  const truncated = Math.trunc(value);
  if (truncated < min) return min;
  if (truncated > max) return max;
  return truncated;
}

function assertObjectType(value: string): PullTokenObjectType {
  if (!OBJECT_TYPES.has(value as PullTokenObjectType)) {
    throw new Error(`Invalid pull-token object_type: ${value}`);
  }
  return value as PullTokenObjectType;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Issue a new pull-token. The raw token is returned ONCE — the caller is
 * responsible for surfacing it to the user (popover) and never persisting
 * it server-side.
 *
 * Validation:
 *   - ttlSeconds clamped to [60, 86400]
 *   - slidingWindowSeconds clamped to [0, 86400]
 *   - maxRedemptions clamped to [1, 10000]
 */
export async function issuePullToken(
  client: SupabaseClient,
  input: IssuePullTokenInput
): Promise<{ token: string; summary: PullTokenSummary }> {
  const objectType = assertObjectType(input.objectType);

  const ttlSeconds = clampInt(
    input.ttlSeconds,
    TTL_MIN_SECONDS,
    TTL_MAX_SECONDS
  );
  const slidingWindowSeconds = clampInt(
    input.slidingWindowSeconds ?? 0,
    0,
    SLIDING_MAX_SECONDS
  );
  const maxRedemptions = clampInt(
    input.maxRedemptions ?? 100,
    REDEMPTIONS_MIN,
    REDEMPTIONS_MAX
  );

  const token = generateToken();
  const tokenHash = hashPullToken(token);
  const tokenPrefix = token.slice(0, TOKEN_PREFIX_DISPLAY_LEN);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  // hard_cap_at is the hard ceiling — even with a sliding window we can never
  // extend past this. v1 sets it equal to the initial expiry, so the window
  // never grows past the originally requested TTL.
  const hardCapAt = expiresAt;

  const { data, error } = await client
    .from("pull_tokens")
    .insert({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      object_type: objectType,
      object_id: input.objectId,
      write_capable: input.writeCapable === true,
      expires_at: expiresAt,
      hard_cap_at: hardCapAt,
      sliding_window_seconds: slidingWindowSeconds,
      max_redemptions: maxRedemptions,
    })
    .select()
    .single();

  if (error || !data) {
    logger.error({ err: error }, "issuePullToken insert failed");
    throw new Error("Failed to issue pull-token");
  }

  return { token, summary: rowToSummary(data as PullTokenRow) };
}

/**
 * List all (active + revoked + expired) pull-tokens for the given user
 * in the given workspace, newest first.
 */
export async function listPullTokensForUser(
  client: SupabaseClient,
  workspaceId: string,
  userId: string
): Promise<PullTokenSummary[]> {
  const { data, error } = await client
    .from("pull_tokens")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error({ err: error }, "listPullTokensForUser failed");
    throw new Error("Failed to list pull-tokens");
  }

  return (data as PullTokenRow[]).map(rowToSummary);
}

/**
 * Revoke a pull-token. Idempotent: revoking a token that's already revoked
 * is a no-op. The tokenId / userId pair must match — we never let one user
 * revoke another's tokens, even in service-role contexts.
 */
export async function revokePullToken(
  client: SupabaseClient,
  tokenId: string,
  userId: string
): Promise<void> {
  const { error } = await client
    .from("pull_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .eq("user_id", userId)
    .is("revoked_at", null);

  if (error) {
    logger.error({ err: error, tokenId }, "revokePullToken failed");
    throw new Error("Failed to revoke pull-token");
  }
}

/**
 * Atomically redeem a raw token string. Returns null when the token is
 * unknown, revoked, expired, or has hit max_redemptions.
 *
 * The user-agent is recorded for monitoring — pass `null` if the request
 * has none. We never throw on non-existent tokens; the caller should
 * respond with 401.
 */
export async function redeemPullToken(
  adminClient: SupabaseClient,
  tokenString: string,
  userAgent: string | null
): Promise<RedeemResult | null> {
  if (
    typeof tokenString !== "string" ||
    !tokenString.startsWith(PULL_TOKEN_PREFIX)
  ) {
    return null;
  }

  const tokenHash = hashPullToken(tokenString);

  const { data, error } = await adminClient.rpc("redeem_pull_token", {
    p_token_hash: tokenHash,
    p_user_agent: userAgent ?? null,
  });

  if (error) {
    logger.error({ err: error }, "redeem_pull_token RPC failed");
    return null;
  }

  // The RPC returns SETOF; the JS client surfaces this as an array.
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length === 0) return null;

  const row = rows[0] as {
    workspace_id: string;
    user_id: string;
    object_type: PullTokenObjectType;
    object_id: string;
    write_capable: boolean;
    new_expires_at: string;
  };

  const newExpiresAt = row.new_expires_at;
  const expiresInSeconds = Math.max(
    0,
    Math.floor((Date.parse(newExpiresAt) - Date.now()) / 1000)
  );

  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    objectType: row.object_type,
    objectId: row.object_id,
    writeCapable: row.write_capable,
    newExpiresAt,
    expiresInSeconds,
  };
}

/**
 * Look up the row id for a token string without redeeming it. Used by the
 * audit pipeline so we can attach a token_id to events without piping the
 * raw token through the audit helpers.
 */
export async function lookupPullTokenIdByString(
  adminClient: SupabaseClient,
  tokenString: string
): Promise<string | null> {
  if (
    typeof tokenString !== "string" ||
    !tokenString.startsWith(PULL_TOKEN_PREFIX)
  ) {
    return null;
  }
  const tokenHash = hashPullToken(tokenString);
  const { data, error } = await adminClient
    .from("pull_tokens")
    .select("id")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/**
 * Read-only aggregate for the admin perf dashboard tile.
 *
 * Window defaults to 24 h. Returns zeroes (not throws) when the
 * underlying tables are empty so the tile can render an honest
 * "0 reads · 0 writes" rather than an error state.
 *
 * Counts are derived from `audit_events`:
 *   - reads:           bundle.pulled with metadata.mode = 'read'
 *   - writes:          bundle.pulled with metadata.mode = 'write'
 *   - invalidAttempts: bundle.pulled_invalid
 *   - activeTokens:    pull_tokens rows where revoked_at IS NULL
 *                      AND expires_at > now()
 */
export async function getPullTokenActivitySummary(
  client: SupabaseClient,
  workspaceId: string,
  windowMs: number = 24 * 60 * 60 * 1000
): Promise<PullTokenActivitySummary> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs).toISOString();

  // Active token count (cheap exact count via head-only query).
  const activeRes = await client
    .from("pull_tokens")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString());

  // Audit events in the window. We pull only the metadata column we need.
  const eventsRes = await client
    .from("audit_events")
    .select("event_type, metadata")
    .eq("workspace_id", workspaceId)
    .in("event_type", PULL_TOKEN_AUDIT_EVENT_TYPES as unknown as string[])
    .gte("created_at", windowStart);

  let reads = 0;
  let writes = 0;
  let invalidAttempts = 0;

  if (!eventsRes.error && Array.isArray(eventsRes.data)) {
    for (const ev of eventsRes.data as Array<{
      event_type: string;
      metadata: Record<string, unknown> | null;
    }>) {
      if (ev.event_type === "bundle.pulled_invalid") {
        invalidAttempts++;
        continue;
      }
      if (ev.event_type === "bundle.pulled") {
        const mode =
          ev.metadata && typeof ev.metadata === "object"
            ? (ev.metadata as Record<string, unknown>).mode
            : undefined;
        if (mode === "write") writes++;
        else reads++;
      }
    }
  }

  return {
    reads,
    writes,
    activeTokens: activeRes.count ?? 0,
    invalidAttempts,
    generatedAt: now.toISOString(),
    windowMs,
  };
}
