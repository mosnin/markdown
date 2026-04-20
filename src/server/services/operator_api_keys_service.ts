import { type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Operator REST API keys.
 *
 * Bearer tokens scoped to a specific (user, workspace) pair, used by
 * external scripts / curl / CI to dispatch Operator runs via
 * `POST /api/operator/runs`. The cookie session path
 * (workspace_operator/actions.ts) is unaffected.
 *
 * Format: `wopr_` + 32 hex chars (so a full key is 37 chars). The hex
 * alphabet is intentional — it round-trips through shell heredocs
 * cleanly and never contains URL-special characters.
 *
 * Storage: only the sha256 hash hits the DB. The raw key is shown to
 * the user exactly once at creation time and then forgotten by the
 * server. The first 12 chars of the raw key are stored as `key_prefix`
 * for display in the management UI ("wopr_abc123…"). The hash, not
 * the prefix, is the unique key — a hash collision on the prefix is
 * not a security event because the full hash still differs.
 *
 * Verification (`verifyApiKey`) bypasses RLS via the admin client
 * because there is no user session to derive auth.uid() from at the
 * REST entry-point. The function explicitly enforces that the key is
 * not revoked and stamps last_used_at.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

export const OPERATOR_API_KEY_PREFIX = "wopr_";
export const OPERATOR_API_KEY_PREFIX_DISPLAY_LEN = 12; // wopr_ + 7 chars
const KEY_BYTES = 16; // 16 bytes → 32 hex chars

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OperatorApiKeyRow {
  id: string;
  user_id: string;
  workspace_id: string;
  name: string;
  key_prefix: string;
  // We never read key_hash to the caller — keep it on the row type but
  // omit from the public list shape below.
  key_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** Public-shaped row — never includes key_hash. */
export interface OperatorApiKeyPublic {
  id: string;
  workspace_id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CreateApiKeyArgs {
  userId: string;
  workspaceId: string;
  name: string;
}

export interface CreatedApiKey {
  id: string;
  /**
   * The raw bearer token. Must be returned to the user exactly once
   * and then forgotten — there is no recovery path.
   */
  rawKey: string;
  prefix: string;
  workspaceId: string;
  name: string;
  createdAt: string;
}

export interface VerifiedApiKey {
  id: string;
  userId: string;
  workspaceId: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateRawKey(): string {
  return `${OPERATOR_API_KEY_PREFIX}${randomBytes(KEY_BYTES).toString("hex")}`;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("API key name is required");
  if (trimmed.length > 80) {
    throw new Error("API key name must be 80 characters or fewer");
  }
  return trimmed;
}

function toPublic(row: OperatorApiKeyRow): OperatorApiKeyPublic {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    key_prefix: row.key_prefix,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
  };
}

// ─── Create ─────────────────────────────────────────────────────────────────

/**
 * Mint a new API key. The cookie-client `supabase` arg is used so the
 * INSERT goes through RLS (`auth.uid() = user_id` + workspace
 * membership). Returns the raw key — show it to the user once and then
 * forget it.
 */
export async function createApiKey(
  supabase: SupabaseClient,
  args: CreateApiKeyArgs
): Promise<CreatedApiKey> {
  const name = validateName(args.name);
  const rawKey = generateRawKey();
  const prefix = rawKey.slice(0, OPERATOR_API_KEY_PREFIX_DISPLAY_LEN);
  const hash = sha256Hex(rawKey);

  const { data, error } = await supabase
    .from("operator_api_keys")
    .insert({
      user_id: args.userId,
      workspace_id: args.workspaceId,
      name,
      key_prefix: prefix,
      key_hash: hash,
    })
    .select("id, created_at")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create API key: ${error?.message ?? "unknown"}`);
  }

  return {
    id: data.id as string,
    rawKey,
    prefix,
    workspaceId: args.workspaceId,
    name,
    createdAt: data.created_at as string,
  };
}

// ─── Verify ─────────────────────────────────────────────────────────────────

/**
 * Verify a presented bearer token. Returns the (userId, workspaceId)
 * tuple on success or null on any failure. Side effect: stamps
 * `last_used_at` on the row.
 *
 * Bypasses RLS via the admin client by design — there is no user
 * session to derive auth from at the REST entry point. The returned
 * caller scope is the source of truth for downstream authorization.
 *
 * The `clientFactory` parameter is exposed strictly for unit tests so
 * the hash-storage assertion can run without touching the real Supabase
 * environment. Production callers pass nothing and get the admin client.
 */
export async function verifyApiKey(
  rawKey: string,
  clientFactory: () => SupabaseClient = createAdminClient
): Promise<VerifiedApiKey | null> {
  if (typeof rawKey !== "string" || !rawKey.startsWith(OPERATOR_API_KEY_PREFIX)) {
    return null;
  }
  // Quick shape check — wopr_ + 32 hex chars.
  if (rawKey.length !== OPERATOR_API_KEY_PREFIX.length + KEY_BYTES * 2) {
    return null;
  }
  if (!/^[0-9a-f]+$/i.test(rawKey.slice(OPERATOR_API_KEY_PREFIX.length))) {
    return null;
  }

  const presentedHash = sha256Hex(rawKey);
  const supabase = clientFactory();

  const { data: row } = await supabase
    .from("operator_api_keys")
    .select("id, user_id, workspace_id, key_hash, revoked_at")
    .eq("key_hash", presentedHash)
    .maybeSingle();

  if (!row) return null;
  const r = row as Pick<
    OperatorApiKeyRow,
    "id" | "user_id" | "workspace_id" | "key_hash" | "revoked_at"
  >;
  if (r.revoked_at) return null;

  // Constant-time compare on the hash — defense in depth even though
  // we already filtered by hash equality (Postgres index lookup is
  // not constant-time on the input).
  const a = Buffer.from(r.key_hash, "hex");
  const b = Buffer.from(presentedHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Stamp last_used_at — best-effort; never fail the request on a write
  // glitch. We use the same admin client because the cookie client
  // doesn't have an auth.uid() at this point.
  void supabase
    .from("operator_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", r.id)
    .then(() => undefined);

  return {
    id: r.id,
    userId: r.user_id,
    workspaceId: r.workspace_id,
  };
}

// ─── Revoke ─────────────────────────────────────────────────────────────────

/**
 * Soft-delete an API key by stamping `revoked_at`. Idempotent — calling
 * twice on the same id is fine. Returns true when a row was actually
 * stamped (was live before this call), false when no row matched or it
 * was already revoked.
 */
export async function revokeApiKey(
  supabase: SupabaseClient,
  id: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("operator_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id");

  if (error) {
    throw new Error(`Failed to revoke API key: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

// ─── List ───────────────────────────────────────────────────────────────────

/**
 * List the keys a user owns across all their workspaces, newest first.
 * Returns the public-shape (no key_hash). RLS already restricts to the
 * caller's rows; the explicit user_id filter is defensive.
 */
export async function listApiKeysForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<OperatorApiKeyPublic[]> {
  const { data, error } = await supabase
    .from("operator_api_keys")
    .select(
      "id, user_id, workspace_id, name, key_prefix, key_hash, created_at, last_used_at, revoked_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list API keys: ${error.message}`);
  }
  return ((data ?? []) as OperatorApiKeyRow[]).map(toPublic);
}

// ─── Bearer parse helper (used by the REST routes) ──────────────────────────

/**
 * Extract a wopr_ bearer key from an `Authorization` header. Returns
 * null when the header is absent, malformed, or carries a different
 * scheme. Unit-tested in operator_api_keys_service.test.ts.
 */
export function parseOperatorBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const raw = header.slice(7).trim();
  if (!raw.startsWith(OPERATOR_API_KEY_PREFIX)) return null;
  return raw;
}
