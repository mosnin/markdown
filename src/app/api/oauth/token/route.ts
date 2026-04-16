import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  _internalGetClientWithSecret,
  verifyClientSecret,
  isRedirectUriAllowed,
} from "@/server/services/oauth_client_service";
import {
  redeemAuthorizationCode,
  issueTokenPair,
  refreshTokenPair,
  ACCESS_TOKEN_TTL_SECONDS,
  type IssuedTokenPair,
} from "@/server/services/oauth_token_service";
import { parseScopeString } from "@/server/services/oauth_scope_service";
import {
  auditOauthTokenIssued,
  auditOauthTokenRefreshed,
  auditRateLimitTripped,
} from "@/server/services/audit_service";
import {
  checkRateLimit,
  tokenBucketKey,
  TOKEN_LIMIT,
} from "@/server/services/rate_limit_service";

/**
 * OAuth 2.1 token endpoint (RFC 6749 §3.2 with OAuth 2.1 tightening).
 *
 * Supports two grant types:
 *
 *   * authorization_code — exchange the single-use code from the
 *     authorize redirect for an access + refresh token pair. PKCE
 *     code_verifier is required.
 *   * refresh_token — exchange a refresh token for a new access +
 *     refresh token pair. The old refresh token is rotated.
 *
 * Client authentication:
 *
 *   * Confidential clients authenticate with client_secret_basic
 *     (Authorization: Basic base64(client_id:client_secret)) or
 *     client_secret_post (client_id + client_secret in the body).
 *   * Public clients present only client_id; authentication is via
 *     PKCE.
 *
 * Rate limiting:
 *
 *   * 30 requests per minute per `client_id` via the durable
 *     `rate_limit_buckets` table. Exceeding returns 429 with the
 *     Retry-After header. Rate-limit trips are audited via
 *     `auditRateLimitTripped`.
 *
 * Responses are standard OAuth JSON per RFC 6749; errors use the
 * `{ error, error_description }` envelope.
 */

type TokenRequest = {
  grant_type: string;
  code?: string;
  redirect_uri?: string;
  code_verifier?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  scope?: string;
};

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await parseBody(req);
  const { clientId, clientSecret } = resolveClientAuth(req, body);
  if (!clientId) return tokenError("invalid_client", "client_id is required");

  const admin = createAdminClient();

  // Rate limit per client_id BEFORE any DB lookups so an unknown client
  // cannot be used as an oracle to hammer the token endpoint.
  const rl = await checkRateLimit(admin, tokenBucketKey(clientId), TOKEN_LIMIT);
  if (!rl.allowed) {
    // Audit is best-effort; we don't know the user yet at this point.
    await auditRateLimitTripped({
      supabase: admin,
      workspaceId: null,
      userId: null,
      bucketKey: rl.bucketKey,
      limit: rl.limit,
    });
    return rateLimited(rl.retryAfterSeconds);
  }

  const client = await _internalGetClientWithSecret(admin, clientId);
  if (!client) return tokenError("invalid_client", "Unknown client");

  // Confidential client? Must present a valid secret.
  if (client.is_confidential) {
    if (!clientSecret) return tokenError("invalid_client", "Client secret required");
    if (!verifyClientSecret(client, clientSecret)) {
      return tokenError("invalid_client", "Invalid client secret");
    }
  }

  switch (body.grant_type) {
    case "authorization_code":
      return handleAuthorizationCode(admin, client.id, client.client_id, body);
    case "refresh_token":
      return handleRefreshToken(admin, client.id, client.client_id, body);
    default:
      return tokenError("unsupported_grant_type", `grant_type=${body.grant_type} is not supported`);
  }
}

async function handleAuthorizationCode(
  admin: ReturnType<typeof createAdminClient>,
  clientRowId: string,
  clientId: string,
  body: TokenRequest
) {
  if (!body.code) return tokenError("invalid_request", "code is required");
  if (!body.redirect_uri) return tokenError("invalid_request", "redirect_uri is required");
  if (!body.code_verifier) return tokenError("invalid_request", "code_verifier (PKCE) is required");

  // Belt-and-suspenders: even though redeemAuthorizationCode verifies
  // the redirect_uri matches the one captured at authorize time, also
  // confirm it's one of the client's registered redirect URIs. This
  // protects against races where the client row changed after the
  // authorize call.
  const client = await _internalGetClientWithSecret(admin, clientId);
  if (!client || !isRedirectUriAllowed(client, body.redirect_uri)) {
    return tokenError("invalid_grant", "redirect_uri mismatch");
  }

  const redemption = await redeemAuthorizationCode(admin, {
    code: body.code,
    clientId,
    redirectUri: body.redirect_uri,
    codeVerifier: body.code_verifier,
  });
  if (!redemption.ok) return tokenError(redemption.error, "Authorization code cannot be redeemed.");

  const pair = await issueTokenPair(admin, {
    clientId,
    userId: redemption.userId,
    workspaceId: redemption.workspaceId,
    scope: redemption.scope,
  });

  await auditOauthTokenIssued({
    supabase: admin,
    workspaceId: redemption.workspaceId,
    userId: redemption.userId,
    clientId,
    clientRowId,
    grantType: "authorization_code",
    tokenId: pair.accessTokenId,
  });

  return tokenSuccess(pair);
}

async function handleRefreshToken(
  admin: ReturnType<typeof createAdminClient>,
  clientRowId: string,
  clientId: string,
  body: TokenRequest
) {
  if (!body.refresh_token) return tokenError("invalid_request", "refresh_token is required");
  const narrow = body.scope ? parseScopeString(body.scope) : undefined;

  const result = await refreshTokenPair(admin, {
    refreshToken: body.refresh_token,
    clientId,
    scope: narrow,
  });

  if ("ok" in result && result.ok === false) {
    return tokenError(result.error, "Refresh token cannot be exchanged.");
  }
  const pair = result as IssuedTokenPair;

  await auditOauthTokenRefreshed({
    supabase: admin,
    workspaceId: pair.workspaceId,
    userId: pair.userId,
    clientId,
    clientRowId,
    newTokenId: pair.accessTokenId,
    rotatedFromTokenId: pair.rotatedFromRefreshTokenId ?? "",
  });

  return tokenSuccess(pair);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function parseBody(req: NextRequest): Promise<TokenRequest> {
  // Standard OAuth token endpoint expects application/x-www-form-urlencoded,
  // but we also accept JSON for convenience when poking from curl -d.
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return (await req.json()) as TokenRequest;
    } catch {
      return { grant_type: "" };
    }
  }
  const form = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) out[k] = String(v);
  return out as unknown as TokenRequest;
}

function resolveClientAuth(
  req: NextRequest,
  body: TokenRequest
): { clientId: string | null; clientSecret: string | null } {
  // Prefer HTTP Basic (client_secret_basic) over body fields per OAuth 2.1.
  const authz = req.headers.get("authorization");
  if (authz?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authz.slice(6), "base64").toString("utf-8");
      const idx = decoded.indexOf(":");
      if (idx > 0) {
        return {
          clientId: decoded.slice(0, idx),
          clientSecret: decoded.slice(idx + 1),
        };
      }
    } catch {
      // fallthrough
    }
  }
  return {
    clientId: body.client_id ?? null,
    clientSecret: body.client_secret ?? null,
  };
}

function tokenSuccess(pair: {
  accessToken: string;
  refreshToken: string;
  scope: string[];
}) {
  return NextResponse.json(
    {
      access_token: pair.accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: pair.refreshToken,
      scope: pair.scope.join(" "),
    },
    {
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    }
  );
}

function tokenError(code: string, description: string) {
  return NextResponse.json(
    { error: code, error_description: description },
    {
      status: code === "invalid_client" ? 401 : 400,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    }
  );
}

function rateLimited(retryAfterSeconds: number) {
  return NextResponse.json(
    {
      error: "rate_limited",
      error_description: `Too many token requests. Retry after ${retryAfterSeconds} seconds.`,
    },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "Retry-After": String(retryAfterSeconds),
      },
    }
  );
}
