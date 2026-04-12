import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { _internalGetClientWithSecret, verifyClientSecret } from "@/server/services/oauth_client_service";
import { revokeToken } from "@/server/services/oauth_token_service";

/**
 * OAuth 2.0 Token Revocation (RFC 7009).
 *
 * Always returns 200 on success and on unknown tokens — the spec
 * mandates this to prevent probing. Client authentication is required
 * for confidential clients; public clients present only client_id.
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

  await revokeToken(admin, token);
  // Per RFC 7009, respond 200 even if the token was unknown. We don't
  // leak whether the token existed.
  return new NextResponse(null, {
    status: 200,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
