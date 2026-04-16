import { type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, createHash, timingSafeEqual } from "crypto";
import {
  parseScopeString,
  serializeScopes,
  type OAuthScope,
} from "./oauth_scope_service";

/**
 * OAuth 2.1 token minting and verification.
 *
 * Tokens are opaque 32-byte urlsafe-base64 strings. We store a
 * `token_prefix` (first 8 characters) for O(1) lookup and a SHA-256
 * hash of the full token for constant-time verification. This is the
 * same pattern the existing connection_tokens table uses; reusing it
 * means the code path is familiar and auditable.
 *
 * Lifetimes:
 *
 *   * Authorization code: 10 minutes, single-use.
 *   * Access token:       1 hour (3600s).
 *   * Refresh token:      30 days, rotated on every use.
 *
 * Rotation invariant: using a refresh token invalidates the old
 * refresh token and its paired access token, and issues a new pair.
 * Reusing a revoked refresh token nukes the whole family
 * (family_id-scoped revoke) as a defense against token replay.
 */

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;          // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60;     // 10 minutes

const ACCESS_PREFIX = "cso_a_";
const REFRESH_PREFIX = "cso_r_";
const CODE_PREFIX = "cso_c_";

// ─── Utilities ───────────────────────────────────────────────────────────────

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function nowPlus(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

// Public utility — other modules use this to parse Authorization headers.
export interface ParsedAccessTokenAuth {
  prefix: string;
  hash: string;
  full: string;
}

export function parseBearerAccessToken(authorizationHeader: string | null | undefined): ParsedAccessTokenAuth | null {
  if (!authorizationHeader) return null;
  if (!authorizationHeader.startsWith("Bearer ")) return null;
  const raw = authorizationHeader.slice(7).trim();
  if (!raw.startsWith(ACCESS_PREFIX)) return null;
  const prefix = raw.slice(0, 14); // cso_a_ + 8 chars
  return { prefix, hash: sha256(raw), full: raw };
}

// ─── Authorization codes ─────────────────────────────────────────────────────

export interface IssueAuthorizationCodeInput {
  clientId: string;
  userId: string;
  workspaceId: string;
  redirectUri: string;
  scope: OAuthScope[];
  codeChallenge: string;
}

export async function issueAuthorizationCode(
  supabase: SupabaseClient,
  input: IssueAuthorizationCodeInput
): Promise<{ code: string; expiresAt: string }> {
  const rawCode = `${CODE_PREFIX}${randomToken()}`;
  const codeHash = sha256(rawCode);
  const expiresAt = nowPlus(AUTHORIZATION_CODE_TTL_SECONDS);

  const { error } = await supabase
    .from("oauth_authorization_codes")
    .insert({
      code_hash: codeHash,
      client_id: input.clientId,
      user_id: input.userId,
      workspace_id: input.workspaceId,
      redirect_uri: input.redirectUri,
      scope: serializeScopes(input.scope),
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
      expires_at: expiresAt,
    });
  if (error) throw new Error(error.message);
  return { code: rawCode, expiresAt };
}

/**
 * Redeem an authorization code. Single-use — marks the row as used
 * inside the SELECT→UPDATE race via `used_at IS NULL` predicate.
 * Verifies the PKCE code_verifier against the stored challenge.
 */
export async function redeemAuthorizationCode(
  supabase: SupabaseClient,
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  }
): Promise<
  | { ok: true; userId: string; workspaceId: string; scope: OAuthScope[] }
  | { ok: false; error: string }
> {
  if (!input.code.startsWith(CODE_PREFIX)) {
    return { ok: false, error: "invalid_grant" };
  }
  const codeHash = sha256(input.code);
  const { data: row } = await supabase
    .from("oauth_authorization_codes")
    .select("*")
    .eq("code_hash", codeHash)
    .maybeSingle();

  if (!row) return { ok: false, error: "invalid_grant" };
  if (row.used_at) return { ok: false, error: "invalid_grant" };
  if (new Date(row.expires_at) < new Date()) return { ok: false, error: "invalid_grant" };
  if (row.client_id !== input.clientId) return { ok: false, error: "invalid_grant" };
  if (row.redirect_uri !== input.redirectUri) return { ok: false, error: "invalid_grant" };

  // PKCE: the code_verifier must hash to the stored code_challenge
  // using the S256 method. Constant-time comparison on the base64url
  // bytes so an attacker cannot learn the challenge via timing.
  const computedChallenge = createHash("sha256")
    .update(input.codeVerifier)
    .digest()
    .toString("base64url");
  const a = Buffer.from(computedChallenge);
  const b = Buffer.from(row.code_challenge);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "invalid_grant" };
  }

  // Mark used with a CAS on used_at IS NULL. If two exchanges race,
  // only one wins; the loser sees used_at set and fails.
  const { error: updErr, data: updated } = await supabase
    .from("oauth_authorization_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (updErr || !updated) return { ok: false, error: "invalid_grant" };

  return {
    ok: true,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    scope: parseScopeString(row.scope),
  };
}

// ─── Access + refresh token pair ─────────────────────────────────────────────

export interface IssuedTokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  scope: OAuthScope[];
  tokenType: "Bearer";
  expiresInSeconds: number;
  /**
   * Row id of the minted `oauth_access_tokens` row. Callers use this
   * for audit attribution (`metadata.token_id`) without having to
   * re-query by hash.
   */
  accessTokenId: string;
  /**
   * Row id of the minted `oauth_refresh_tokens` row. Populated after
   * the insert returns so the audit event for rotation can name the
   * new row explicitly.
   */
  refreshTokenId: string;
  /**
   * Meaningful only for rotation (`refreshTokenPair`). Set to the
   * pre-rotation refresh token row id so audit events can link the
   * rotation chain. Null for fresh `issueTokenPair` calls.
   */
  rotatedFromRefreshTokenId: string | null;
  /** Workspace the pair belongs to — echoed for audit convenience. */
  workspaceId: string;
  /** User the pair was issued to — echoed for audit convenience. */
  userId: string;
  /** Client the pair was issued to — echoed for audit convenience. */
  clientId: string;
}

export async function issueTokenPair(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    userId: string;
    workspaceId: string;
    scope: OAuthScope[];
    familyId?: string;
  }
): Promise<IssuedTokenPair> {
  const accessRaw = `${ACCESS_PREFIX}${randomToken()}`;
  const refreshRaw = `${REFRESH_PREFIX}${randomToken()}`;

  const accessExpiresAt = nowPlus(ACCESS_TOKEN_TTL_SECONDS);
  const refreshExpiresAt = nowPlus(REFRESH_TOKEN_TTL_SECONDS);

  const { data: accessRow, error: accErr } = await supabase
    .from("oauth_access_tokens")
    .insert({
      token_prefix: accessRaw.slice(0, 14),
      token_hash: sha256(accessRaw),
      client_id: input.clientId,
      user_id: input.userId,
      workspace_id: input.workspaceId,
      scope: serializeScopes(input.scope),
      expires_at: accessExpiresAt,
    })
    .select("id")
    .single();
  if (accErr || !accessRow) {
    throw new Error(accErr?.message ?? "Failed to issue access token");
  }

  const familyId = input.familyId ?? crypto.randomUUID();

  const { data: refreshRow, error: refErr } = await supabase
    .from("oauth_refresh_tokens")
    .insert({
      token_prefix: refreshRaw.slice(0, 14),
      token_hash: sha256(refreshRaw),
      client_id: input.clientId,
      user_id: input.userId,
      workspace_id: input.workspaceId,
      scope: serializeScopes(input.scope),
      access_token_id: accessRow.id,
      family_id: familyId,
      expires_at: refreshExpiresAt,
    })
    .select("id")
    .single();
  if (refErr || !refreshRow) {
    throw new Error(refErr?.message ?? "Failed to issue refresh token");
  }

  return {
    accessToken: accessRaw,
    accessTokenExpiresAt: accessExpiresAt,
    refreshToken: refreshRaw,
    refreshTokenExpiresAt: refreshExpiresAt,
    scope: input.scope,
    tokenType: "Bearer",
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    accessTokenId: accessRow.id,
    refreshTokenId: refreshRow.id,
    rotatedFromRefreshTokenId: null,
    workspaceId: input.workspaceId,
    userId: input.userId,
    clientId: input.clientId,
  };
}

/**
 * Exchange a refresh token for a new access/refresh token pair.
 *
 * Rotation rules:
 *   - The old refresh token is marked used_at.
 *   - Its paired access token is revoked.
 *   - The new tokens share the same family_id.
 *   - If the presented refresh token has already been used (replay),
 *     the entire family is revoked — a theft signal.
 */
export async function refreshTokenPair(
  supabase: SupabaseClient,
  input: {
    refreshToken: string;
    clientId: string;
    scope?: OAuthScope[]; // optional narrowing on refresh
  }
): Promise<IssuedTokenPair | { ok: false; error: string }> {
  if (!input.refreshToken.startsWith(REFRESH_PREFIX)) {
    return { ok: false, error: "invalid_grant" };
  }
  const hash = sha256(input.refreshToken);
  const { data: row } = await supabase
    .from("oauth_refresh_tokens")
    .select("*")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!row) return { ok: false, error: "invalid_grant" };
  if (row.client_id !== input.clientId) return { ok: false, error: "invalid_client" };

  if (row.revoked_at) {
    // A revoked refresh token is being presented — theft suspicion.
    // Revoke every live token in the family and fail the request.
    await revokeFamily(supabase, row.family_id);
    return { ok: false, error: "invalid_grant" };
  }
  if (row.used_at) {
    // Replay of an already-rotated refresh token. Same defense as
    // above; nothing good happens from here.
    await revokeFamily(supabase, row.family_id);
    return { ok: false, error: "invalid_grant" };
  }
  if (new Date(row.expires_at) < new Date()) return { ok: false, error: "invalid_grant" };

  const currentScopes = parseScopeString(row.scope);
  const requestedScopes = input.scope ?? currentScopes;
  // A client may narrow the scope on refresh but not broaden it.
  const narrowed = requestedScopes.filter((s) => currentScopes.includes(s));

  // Mark the old refresh + access revoked.
  await supabase
    .from("oauth_refresh_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id);
  if (row.access_token_id) {
    await supabase
      .from("oauth_access_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", row.access_token_id);
  }

  const newPair = await issueTokenPair(supabase, {
    clientId: row.client_id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    scope: narrowed,
    familyId: row.family_id,
  });

  // Link the old row's replaced_by_token_id to the new refresh row for
  // chain traceability.
  await supabase
    .from("oauth_refresh_tokens")
    .update({ replaced_by_token_id: newPair.refreshTokenId })
    .eq("id", row.id);

  return {
    ...newPair,
    rotatedFromRefreshTokenId: row.id,
  };
}

async function revokeFamily(supabase: SupabaseClient, familyId: string) {
  await supabase
    .from("oauth_refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("family_id", familyId)
    .is("revoked_at", null);
  // Access tokens don't have family_id; we revoke any access tokens
  // whose access_token_id appears in the family.
  const { data: rows } = await supabase
    .from("oauth_refresh_tokens")
    .select("access_token_id")
    .eq("family_id", familyId);
  const ids = (rows ?? [])
    .map((r) => r.access_token_id)
    .filter((x): x is string => !!x);
  if (ids.length > 0) {
    await supabase
      .from("oauth_access_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .in("id", ids)
      .is("revoked_at", null);
  }
}

// ─── Verification (used by MCP / canonical API inbound) ──────────────────────

export interface ResolvedAccessToken {
  tokenId: string;
  clientId: string;
  userId: string;
  workspaceId: string;
  scope: OAuthScope[];
  expiresAt: string;
}

export async function resolveAccessToken(
  supabase: SupabaseClient,
  bearer: ParsedAccessTokenAuth
): Promise<ResolvedAccessToken | null> {
  const { data: row } = await supabase
    .from("oauth_access_tokens")
    .select("*")
    .eq("token_prefix", bearer.prefix)
    .maybeSingle();
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  // Constant-time compare on the hash.
  const a = Buffer.from(row.token_hash, "hex");
  const b = Buffer.from(bearer.hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Check that the consent this token derived from is still active.
  const { data: consent } = await supabase
    .from("oauth_consents")
    .select("revoked_at")
    .eq("user_id", row.user_id)
    .eq("client_id", row.client_id)
    .eq("workspace_id", row.workspace_id)
    .maybeSingle();
  if (consent?.revoked_at) return null;

  // Best-effort last_used_at update; we don't fail the request on error.
  // Populate first_used_at exactly once, the first time the token
  // actually authenticates a request. Powers the "first seen" column
  // in the Grants UI and distinguishes minted-but-unused tokens.
  const now = new Date().toISOString();
  const patch: Record<string, string> = { last_used_at: now };
  if (!row.first_used_at) patch.first_used_at = now;
  await supabase
    .from("oauth_access_tokens")
    .update(patch)
    .eq("id", row.id);

  return {
    tokenId: row.id,
    clientId: row.client_id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    scope: parseScopeString(row.scope),
    expiresAt: row.expires_at,
  };
}

// ─── Revocation (RFC 7009) ───────────────────────────────────────────────────

/**
 * Revoke a single presented token. Idempotent — already-revoked tokens
 * are treated as success. RFC 7009 requires the 200 response even on
 * unknown tokens to prevent probing; callers should enforce that at
 * the route layer.
 */
export async function revokeToken(
  supabase: SupabaseClient,
  rawToken: string
): Promise<void> {
  const hash = sha256(rawToken);
  if (rawToken.startsWith(ACCESS_PREFIX)) {
    await supabase
      .from("oauth_access_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hash)
      .is("revoked_at", null);
    return;
  }
  if (rawToken.startsWith(REFRESH_PREFIX)) {
    const { data } = await supabase
      .from("oauth_refresh_tokens")
      .select("family_id")
      .eq("token_hash", hash)
      .maybeSingle();
    if (data) await revokeFamily(supabase, data.family_id);
    return;
  }
}

/** Revoke every live token a user has for a specific client/workspace consent. */
export async function revokeConsentTokens(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string; workspaceId: string }
): Promise<void> {
  const { userId, clientId, workspaceId } = input;
  await supabase
    .from("oauth_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null);
  await supabase
    .from("oauth_refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null);
}

/**
 * Revoke every live access + refresh token that derives from a
 * specific consent row. Stamps the consent itself with `revoked_at`
 * so subsequent `resolveAccessToken` calls short-circuit (defense in
 * depth: expired tokens and revoked consent both guard independently).
 */
export async function revokeAllTokensForConsent(
  supabase: SupabaseClient,
  consentId: string
): Promise<void> {
  const { data: consent } = await supabase
    .from("oauth_consents")
    .select("user_id, client_id, workspace_id")
    .eq("id", consentId)
    .maybeSingle();
  if (!consent) return;
  await revokeConsentTokens(supabase, {
    userId: consent.user_id,
    clientId: consent.client_id,
    workspaceId: consent.workspace_id,
  });
  await supabase
    .from("oauth_consents")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", consentId)
    .is("revoked_at", null);
}

// ─── Exports for use by the routes ───────────────────────────────────────────

export { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, AUTHORIZATION_CODE_TTL_SECONDS };
