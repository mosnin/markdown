import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { registerClient } from "@/server/services/oauth_client_service";
import {
  parseBearerAccessToken,
  resolveAccessToken,
} from "@/server/services/oauth_token_service";
import { getRequestContext } from "@/server/auth/get_request_context";
import { ALL_SCOPES, type OAuthScope } from "@/server/services/oauth_scope_service";
import {
  auditOauthClientRegistered,
  auditRateLimitTripped,
} from "@/server/services/audit_service";
import {
  checkRateLimit,
  registerBucketKey,
  REGISTRATION_LIMIT,
} from "@/server/services/rate_limit_service";

/**
 * OAuth 2.0 Dynamic Client Registration (RFC 7591).
 *
 * Lets a connector register itself without operator involvement. The
 * surface is deliberately narrow:
 *
 *   * Only a signed-in Context Store user can register a new client.
 *     Either (a) a Supabase session cookie (human) or (b) an OAuth
 *     access token already issued to the same user is required. No
 *     anonymous registration — that door swings wide for abuse.
 *
 *   * Rate-limited to 3 successful registrations per user per hour
 *     via the durable `rate_limit_buckets` table. Rate-limit trips
 *     are audited.
 *
 *   * Redirect URIs are stored exactly as submitted and must match
 *     byte-for-byte at authorize time. Wildcards and regex patterns
 *     are not accepted.
 *
 *   * Requested scopes are filtered against ALL_SCOPES. Unknown
 *     values are dropped rather than 400'd — this matches RFC 7591
 *     §3.2.1 guidance that the server MAY replace the value.
 *
 *   * Confidential clients receive a single-use secret in the
 *     response. The hash is stored; the plaintext is never retrievable
 *     afterwards.
 *
 * Response shape follows RFC 7591 §3.2 (client_id,
 * client_id_issued_at, client_secret if confidential, etc.).
 */

export const dynamic = "force-dynamic";

interface RegistrationRequest {
  client_name?: string;
  redirect_uris?: string[];
  scope?: string;
  client_uri?: string;
  logo_uri?: string;
  token_endpoint_auth_method?: "none" | "client_secret_basic" | "client_secret_post";
}

export async function POST(req: NextRequest) {
  // Caller auth: either a browser session or an OAuth access token.
  // We require some authenticated Context Store identity to prevent
  // drive-by registration spam — the created_by column captures who
  // owns the registration.
  const callerUserId = await resolveCallerUserId(req);
  if (!callerUserId) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Authenticated Context Store session required to register a client." },
      { status: 401 }
    );
  }

  const admin = createAdminClient();

  // Apply the per-user rate limit before touching the registration
  // path. Rejected calls are audited so operators can see bursts.
  const rl = await checkRateLimit(
    admin,
    registerBucketKey(callerUserId),
    REGISTRATION_LIMIT
  );
  if (!rl.allowed) {
    await auditRateLimitTripped({
      supabase: admin,
      workspaceId: await fallbackWorkspaceId(admin, callerUserId),
      userId: callerUserId,
      bucketKey: rl.bucketKey,
      limit: rl.limit,
    });
    return NextResponse.json(
      {
        error: "rate_limited",
        error_description: `Too many client registrations. Retry after ${rl.retryAfterSeconds} seconds.`,
      },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          "Retry-After": String(rl.retryAfterSeconds),
        },
      }
    );
  }

  let body: RegistrationRequest;
  try {
    body = (await req.json()) as RegistrationRequest;
  } catch {
    return rfcError("invalid_client_metadata", "Request body must be JSON");
  }

  const name = (body.client_name ?? "").trim();
  if (!name) return rfcError("invalid_client_metadata", "client_name is required");
  if (name.length > 200) return rfcError("invalid_client_metadata", "client_name too long");

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (redirectUris.length === 0) {
    return rfcError("invalid_redirect_uri", "At least one redirect_uri is required");
  }
  for (const uri of redirectUris) {
    if (typeof uri !== "string" || !uri) {
      return rfcError("invalid_redirect_uri", "All redirect_uris must be non-empty strings");
    }
    if (uri !== "urn:ietf:wg:oauth:2.0:oob") {
      // Basic URL validation — reject anything that's not a valid URL.
      try {
        new URL(uri);
      } catch {
        return rfcError("invalid_redirect_uri", `Invalid redirect URI: ${uri}`);
      }
    }
  }

  const requestedScopes = (body.scope ?? "").split(/\s+/).filter(Boolean);
  const allowedScopes = requestedScopes.filter((s): s is OAuthScope =>
    (ALL_SCOPES as readonly string[]).includes(s)
  );
  // If the caller asked for NO recognized scopes, default to the
  // minimal read-only set so the client can still discover the tools.
  if (allowedScopes.length === 0) {
    allowedScopes.push("context:read");
  }

  const authMethod = body.token_endpoint_auth_method ?? "none";
  const isConfidential = authMethod !== "none";

  try {
    const { client, client_secret } = await registerClient(admin, {
      name,
      description: null,
      homepage_url: body.client_uri ?? null,
      logo_url: body.logo_uri ?? null,
      redirect_uris: redirectUris,
      allowed_scopes: allowedScopes,
      is_confidential: isConfidential,
      is_first_party: false,
      created_by: callerUserId,
    });

    // Capture the caller IP on the client row for abuse triage. Best-
    // effort — if the column isn't available (e.g. migration hasn't
    // run yet in dev) we fail quiet.
    const callerIp = extractIp(req);
    if (callerIp) {
      await admin
        .from("oauth_clients")
        .update({ last_registration_ip: callerIp })
        .eq("id", client.id);
    }

    // Audit every self-registration so operators have a trail.
    // workspace_id here is synthetic — dynamic registration is
    // user-level, not workspace-level. We fall back to the caller's
    // active workspace for the audit write because audit_events
    // requires one.
    const fallbackWsId = await fallbackWorkspaceId(admin, callerUserId);
    if (fallbackWsId) {
      await auditOauthClientRegistered({
        supabase: admin,
        workspaceId: fallbackWsId,
        userId: callerUserId,
        clientId: client.client_id,
        clientRowId: client.id,
        isConfidential,
        allowedScopes,
        ip: callerIp,
      });
    }

    // RFC 7591 §3.2 response.
    return NextResponse.json(
      {
        client_id: client.client_id,
        client_id_issued_at: Math.floor(new Date(client.created_at).getTime() / 1000),
        ...(client_secret
          ? {
              client_secret,
              // Confidential secrets do not expire in our model; reuse
              // 0 per RFC 7591 to indicate "never".
              client_secret_expires_at: 0,
            }
          : {}),
        client_name: client.name,
        redirect_uris: client.redirect_uris,
        scope: client.allowed_scopes.join(" "),
        token_endpoint_auth_method: isConfidential ? authMethod : "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        },
      }
    );
  } catch (err) {
    return rfcError(
      "invalid_client_metadata",
      err instanceof Error ? err.message : "Registration failed"
    );
  }
}

async function resolveCallerUserId(req: NextRequest): Promise<string | null> {
  // Path 1: OAuth access token. A connector that's already been
  // granted access can self-register new clients on behalf of the
  // same user without a browser round-trip. We do not require any
  // specific scope — self-registration is a developer action.
  const parsedBearer = parseBearerAccessToken(req.headers.get("authorization"));
  if (parsedBearer) {
    const admin = createAdminClient();
    const resolved = await resolveAccessToken(admin, parsedBearer);
    if (resolved) return resolved.userId;
  }
  // Path 2: Supabase session cookie.
  try {
    const ctx = await getRequestContext();
    if (ctx.isAuthenticated && ctx.user) return ctx.user.id;
  } catch {
    // No session.
  }
  return null;
}

async function fallbackWorkspaceId(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<string | null> {
  const { data } = await admin
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId)
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

function extractIp(req: NextRequest): string | null {
  // Next.js on Vercel populates x-forwarded-for; fall back to the
  // connection-level remote address if present.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}

function rfcError(code: string, description: string) {
  return NextResponse.json(
    { error: code, error_description: description },
    {
      status: 400,
      headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
    }
  );
}
