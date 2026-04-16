import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { _internalGetClientWithSecret, verifyClientSecret } from "@/server/services/oauth_client_service";
import { revokeToken } from "@/server/services/oauth_token_service";
import {
  auditOauthTokenRevoked,
  auditRateLimitTripped,
} from "@/server/services/audit_service";
import {
  checkRateLimit,
  revokeBucketKey,
  REVOKE_LIMIT,
} from "@/server/services/rate_limit_service";

/**
 * OAuth 2.0 Token Revocation (RFC 7009).
 *
 * Always returns 200 on success and on unknown tokens — the spec
 * mandates this to prevent probing. Client authentication is required
 * for confidential clients; public clients present only client_id.
 *
 * Rate limiting:
 *
 *   * 30 revocations per minute per owning user via the durable
 *     `rate_limit_buckets` table. The bucket key keys on user when we
 *     can resolve one (by looking up the presented token), else on
 *     client_id so spammy "revoke random tokens" scripts are
 *     throttled.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const clientIdField = String(form.get("client_id") ?? "");
  const clientSecretField = String(form.get("client_secret") ?? "");
  const authz = req.headers.get("authorization");

  let clientId = clientIdField;
  let clientSecret = clientSecretField;
  if (authz?.startsWith("Basic ")) {
    const decoded = Buffer.from(authz.slice(6), "base64").toString("utf-8");
    const idx = decoded.indexOf(":");
    if (idx > 0) {
      clientId = decoded.slice(0, idx);
      clientSecret = decoded.slice(idx + 1);
    }
  }

  if (!clientId) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }
  if (!token) {
    // RFC 7009 §2.1: a missing token parameter is a bad request.
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const admin = createAdminClient();
  const client = await _internalGetClientWithSecret(admin, clientId);
  if (!client) return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  if (client.is_confidential) {
    if (!clientSecret || !verifyClientSecret(client, clientSecret)) {
      return NextResponse.json({ error: "invalid_client" }, { status: 401 });
    }
  }

  // Resolve the token owner (user_id) BEFORE revocation so we can key
  // the rate-limit bucket on the owning user and attribute the audit
  // event to them. A best-effort lookup; missing rows fall back to the
  // client_id bucket.
  const tokenOwner = await lookupTokenOwner(admin, token);
  const rl = await checkRateLimit(
    admin,
    tokenOwner ? revokeBucketKey(tokenOwner.userId) : `oauth_revoke:client:${clientId}`,
    REVOKE_LIMIT
  );
  if (!rl.allowed) {
    await auditRateLimitTripped({
      supabase: admin,
      workspaceId: tokenOwner?.workspaceId ?? null,
      userId: tokenOwner?.userId ?? null,
      bucketKey: rl.bucketKey,
      limit: rl.limit,
    });
    return NextResponse.json(
      {
        error: "rate_limited",
        error_description: `Too many revocation requests. Retry after ${rl.retryAfterSeconds} seconds.`,
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

  await revokeToken(admin, token);

  // Audit every revocation. userId may be null when the presented
  // token was unknown (RFC 7009 mandates 200 on unknown tokens); the
  // audit event still captures the attempt for forensic traceability.
  await auditOauthTokenRevoked({
    supabase: admin,
    workspaceId: tokenOwner?.workspaceId ?? null,
    userId: tokenOwner?.userId ?? null,
    clientId,
    tokenId: tokenOwner?.tokenId ?? null,
    reason: "client_requested",
  });

  // Per RFC 7009, respond 200 even if the token was unknown. We don't
  // leak whether the token existed.
  return new NextResponse(null, {
    status: 200,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

async function lookupTokenOwner(
  admin: ReturnType<typeof createAdminClient>,
  rawToken: string
): Promise<{ userId: string; workspaceId: string; tokenId: string } | null> {
  try {
    // Avoid importing the hashing helper into this route; compute the
    // prefix-based lookup directly via the admin client. SHA-256 of
    // the raw token is stable; we match on the full hash to be exact.
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(rawToken).digest("hex");
    if (rawToken.startsWith("cso_a_")) {
      const { data } = await admin
        .from("oauth_access_tokens")
        .select("id, user_id, workspace_id")
        .eq("token_hash", hash)
        .maybeSingle();
      if (!data) return null;
      return {
        userId: data.user_id,
        workspaceId: data.workspace_id,
        tokenId: data.id,
      };
    }
    if (rawToken.startsWith("cso_r_")) {
      const { data } = await admin
        .from("oauth_refresh_tokens")
        .select("id, user_id, workspace_id")
        .eq("token_hash", hash)
        .maybeSingle();
      if (!data) return null;
      return {
        userId: data.user_id,
        workspaceId: data.workspace_id,
        tokenId: data.id,
      };
    }
    return null;
  } catch {
    return null;
  }
}
