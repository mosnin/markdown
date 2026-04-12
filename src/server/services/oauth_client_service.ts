import { type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes, timingSafeEqual } from "crypto";

/**
 * OAuth client registry service.
 *
 * First-party clients are seeded by the migration. Any additional
 * registrations (third-party developer portal) would go through
 * admin-client writes behind a manage-clients screen. For V1 we expose
 * only lookup + redirect-URI validation + secret verification — the
 * surfaces the authorize and token endpoints need.
 *
 * Secrets:
 *   * Confidential clients have a `client_secret_hash` (SHA-256 of the
 *     raw secret, same pattern as connection_tokens).
 *   * Public clients have no secret; they MUST use PKCE.
 *   * Secrets are shown once at registration and never retrievable.
 */

export interface OAuthClient {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  homepage_url: string | null;
  logo_url: string | null;
  redirect_uris: string[];
  allowed_scopes: string[];
  is_confidential: boolean;
  is_first_party: boolean;
  status: "active" | "suspended" | "deleted";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Internal shape — includes the hash. Only used by the token endpoint;
// never leaks to UI.
interface OAuthClientInternal extends OAuthClient {
  client_secret_hash: string | null;
}

// ─── Lookup ──────────────────────────────────────────────────────────────────

export async function getOAuthClientByClientId(
  supabase: SupabaseClient,
  clientId: string
): Promise<OAuthClient | null> {
  const { data } = await supabase
    .from("oauth_clients")
    .select("id, client_id, name, description, homepage_url, logo_url, redirect_uris, allowed_scopes, is_confidential, is_first_party, status, created_by, created_at, updated_at")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();
  return (data as OAuthClient | null) ?? null;
}

/**
 * Internal helper: get a client including its secret hash, for the
 * token endpoint. MUST never be exposed to the browser or to UI code;
 * only the token route uses it.
 */
export async function _internalGetClientWithSecret(
  supabase: SupabaseClient,
  clientId: string
): Promise<OAuthClientInternal | null> {
  const { data } = await supabase
    .from("oauth_clients")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();
  return (data as OAuthClientInternal | null) ?? null;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Strict redirect-URI comparison. OAuth 2.1 forbids substring / pattern
 * matching here; the presented URI must be an exact string match to
 * one of the registered values. The loopback-IP exception (RFC 8252
 * §7.3) is intentionally not implemented — we register the common
 * loopback URIs explicitly instead, which is safer.
 */
export function isRedirectUriAllowed(client: OAuthClient, presented: string): boolean {
  return client.redirect_uris.includes(presented);
}

/**
 * Verify a client secret against the stored hash using constant-time
 * comparison. Returns `false` for public clients regardless of the
 * presented secret — a public client pretending to be confidential is
 * itself an error.
 */
export function verifyClientSecret(client: OAuthClientInternal, presentedSecret: string): boolean {
  if (!client.is_confidential) return false;
  if (!client.client_secret_hash) return false;
  const presented = createHash("sha256").update(presentedSecret).digest("hex");
  const a = Buffer.from(client.client_secret_hash, "hex");
  const b = Buffer.from(presented, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ─── Registration (admin / service-role only) ────────────────────────────────

export interface RegisterClientInput {
  name: string;
  description?: string | null;
  homepage_url?: string | null;
  logo_url?: string | null;
  redirect_uris: string[];
  allowed_scopes: string[];
  is_confidential: boolean;
  is_first_party?: boolean;
  created_by?: string | null;
}

/** Shown once at registration. */
export interface RegisteredClient {
  client: OAuthClient;
  client_secret?: string;
}

/**
 * Rotate a confidential client's secret. Returns the new raw secret
 * exactly once; the hash overwrites the stored one so the previous
 * secret is immediately invalid. Returns null for public clients or
 * unknown client_ids — callers surface that as a user-facing error.
 *
 * All live access + refresh tokens for the client are intentionally
 * NOT revoked by this function: rotation is about the next outbound
 * token request, not existing sessions. Callers can add a blanket
 * revoke in the surface layer if they need a "force-logout every
 * session" semantic.
 */
export async function rotateClientSecret(
  adminSupabase: SupabaseClient,
  clientId: string
): Promise<string | null> {
  const existing = await _internalGetClientWithSecret(adminSupabase, clientId);
  if (!existing) return null;
  if (!existing.is_confidential) return null;

  const secret = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(secret).digest("hex");

  const { error } = await adminSupabase
    .from("oauth_clients")
    .update({ client_secret_hash: hash })
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);

  return secret;
}

export async function registerClient(
  adminSupabase: SupabaseClient,
  input: RegisterClientInput
): Promise<RegisteredClient> {
  if (input.redirect_uris.length === 0) {
    throw new Error("At least one redirect URI is required");
  }

  // Generate a URL-safe client_id from the name.
  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "client";
  const suffix = randomBytes(4).toString("hex");
  const clientId = `${slug}-${suffix}`;

  let secret: string | undefined;
  let secretHash: string | null = null;
  if (input.is_confidential) {
    secret = randomBytes(32).toString("base64url");
    secretHash = createHash("sha256").update(secret).digest("hex");
  }

  const { data, error } = await adminSupabase
    .from("oauth_clients")
    .insert({
      client_id: clientId,
      client_secret_hash: secretHash,
      name: input.name,
      description: input.description ?? null,
      homepage_url: input.homepage_url ?? null,
      logo_url: input.logo_url ?? null,
      redirect_uris: input.redirect_uris,
      allowed_scopes: input.allowed_scopes,
      is_confidential: input.is_confidential,
      is_first_party: input.is_first_party ?? false,
      status: "active",
      created_by: input.created_by ?? null,
    })
    .select("id, client_id, name, description, homepage_url, logo_url, redirect_uris, allowed_scopes, is_confidential, is_first_party, status, created_by, created_at, updated_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to register client");
  return { client: data as OAuthClient, client_secret: secret };
}
