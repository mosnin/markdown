"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import {
  getOAuthClientByClientId,
  isRedirectUriAllowed,
} from "@/server/services/oauth_client_service";
import {
  parseScopeString,
  resolveGrantedScopes,
  isCapabilityScope,
  type OAuthCapabilityScope,
} from "@/server/services/oauth_scope_service";
import { issueAuthorizationCode } from "@/server/services/oauth_token_service";
import { listAccessibleWorkspaces } from "@/server/repositories/workspace_membership_repository";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { createClient } from "@/lib/supabase/server";
import {
  auditOauthConsentGranted,
  auditRateLimitTripped,
} from "@/server/services/audit_service";
import {
  checkRateLimit,
  authorizeBucketKey,
  AUTHORIZE_LIMIT,
} from "@/server/services/rate_limit_service";

/**
 * Server action invoked by the Approve / Deny buttons on the consent
 * screen. Performs the same validation the page did, with one extra
 * twist: the authorization code is written with the service-role
 * admin client so the subsequent token exchange (which has no user
 * session) can read it back. The user-session client is still the
 * one that gated entry — admins-only writes below are OK because we
 * verify ownership of the workspace inline.
 *
 * Rate limiting: approve/deny are throttled at 10/min per signed-in
 * user via the durable `rate_limit_buckets` table. A user who trips
 * the limit sees a redirect back to the authorize entry with an
 * `error=rate_limited` query so they can retry. Trips are audited.
 */

export async function approveAuthorizeAction(formData: FormData): Promise<never> {
  const clientId = String(formData.get("client_id") ?? "");
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const state = String(formData.get("state") ?? "");
  const codeChallenge = String(formData.get("code_challenge") ?? "");
  const scope = String(formData.get("scope") ?? "");
  const workspaceId = String(formData.get("workspace_id") ?? "");

  const ctx = await requireAuthenticatedUser();

  // Rate limit first — 10 approve/deny submissions per minute per
  // user. Protects both against accidental repeat submits and against
  // a scripted abuser bouncing through the consent surface.
  const admin = createAdminClient();
  const rl = await checkRateLimit(admin, authorizeBucketKey(ctx.user.id), AUTHORIZE_LIMIT);
  if (!rl.allowed) {
    await auditRateLimitTripped({
      supabase: admin,
      workspaceId: workspaceId || null,
      userId: ctx.user.id,
      bucketKey: rl.bucketKey,
      limit: rl.limit,
    });
    redirect(
      errorRedirect(
        redirectUri,
        state,
        "rate_limited",
        `Too many consent submissions. Retry after ${rl.retryAfterSeconds} seconds.`
      )
    );
  }

  // Re-validate everything the page validated. The form is a trust
  // boundary — a crafted POST must still fail safe.
  const sbUser = await createClient();
  const client = await getOAuthClientByClientId(sbUser, clientId);
  if (!client || !isRedirectUriAllowed(client, redirectUri)) {
    // Nowhere safe to redirect — caller must re-start the flow.
    redirect("/oauth/authorize?error=invalid_client");
  }

  const requested = parseScopeString(scope);
  if (requested.length === 0 || !codeChallenge) {
    redirect(errorRedirect(redirectUri, state, "invalid_request", "Missing scope or PKCE challenge."));
  }

  const accessible = await listAccessibleWorkspaces(sbUser, ctx.user.id);
  const selectedWorkspace = accessible.find((w) => w.id === workspaceId);
  if (!selectedWorkspace) {
    redirect(errorRedirect(redirectUri, state, "access_denied", "You do not have access to the selected workspace."));
  }

  // Re-fetch the accessible boxes for the selected workspace so we
  // re-validate any `context:box:<uuid>` scopes against the real
  // membership state at this instant (not what the caller thinks it
  // is). resolveGrantedScopes will reject boxes the user can't reach.
  const accessibleBoxes = await listBoxesByWorkspace(sbUser, selectedWorkspace!.id);
  const accessibleBoxIdSet = new Set(accessibleBoxes.map((b) => b.id));

  const resolution = resolveGrantedScopes({
    requested,
    clientAllowed: client!.allowed_scopes.filter(isCapabilityScope) as OAuthCapabilityScope[],
    role: selectedWorkspace!.role,
    accessibleBoxIds: accessibleBoxIdSet,
  });
  if (!resolution.ok) {
    redirect(errorRedirect(redirectUri, state, "invalid_scope", resolution.error));
  }

  // Persist a consent record so subsequent authorizations for the same
  // (client, workspace, scopes) skip the screen. Admin client to
  // bypass RLS, then explicitly bound to the calling user id.
  await admin
    .from("oauth_consents")
    .upsert(
      {
        user_id: ctx.user.id,
        client_id: client!.client_id,
        workspace_id: selectedWorkspace!.id,
        scopes: resolution.ok ? resolution.scopes : [],
        revoked_at: null,
      },
      { onConflict: "user_id,client_id,workspace_id" }
    );

  // Mint the authorization code, bound to (client, user, workspace,
  // scope, PKCE challenge). The raw code is returned exactly once —
  // the user's browser carries it to the client via the redirect.
  const issued = await issueAuthorizationCode(admin, {
    clientId: client!.client_id,
    userId: ctx.user.id,
    workspaceId: selectedWorkspace!.id,
    redirectUri,
    scope: resolution.ok ? resolution.scopes : [],
    codeChallenge,
  });

  // Audit the approval event via the canonical oauth.consent.granted
  // helper so the attribution shape matches other OAuth events.
  await auditOauthConsentGranted({
    supabase: admin,
    workspaceId: selectedWorkspace!.id,
    userId: ctx.user.id,
    clientId: client!.client_id,
    clientRowId: client!.id,
    scopes: (resolution.ok ? resolution.scopes : []).map(String),
  });

  redirect(codeRedirect(redirectUri, state, issued.code));
}

export async function denyAuthorizeAction(formData: FormData): Promise<never> {
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const state = String(formData.get("state") ?? "");

  // Rate-limit deny the same way as approve — a noisy /deny loop is
  // still noise worth throttling. We skip the limiter if the user
  // isn't authenticated (they'll bounce to the login flow anyway).
  let userId: string | null = null;
  try {
    const ctx = await requireAuthenticatedUser();
    userId = ctx.user.id;
  } catch {
    userId = null;
  }
  if (userId) {
    const admin = createAdminClient();
    const rl = await checkRateLimit(admin, authorizeBucketKey(userId), AUTHORIZE_LIMIT);
    if (!rl.allowed) {
      await auditRateLimitTripped({
        supabase: admin,
        workspaceId: null,
        userId,
        bucketKey: rl.bucketKey,
        limit: rl.limit,
      });
      redirect(
        errorRedirect(
          redirectUri,
          state,
          "rate_limited",
          `Too many consent submissions. Retry after ${rl.retryAfterSeconds} seconds.`
        )
      );
    }
  }

  redirect(errorRedirect(redirectUri, state, "access_denied", "User denied the request."));
}

// ─── URL builders ────────────────────────────────────────────────────────────

function codeRedirect(redirectUri: string, state: string, code: string): string {
  if (redirectUri === "urn:ietf:wg:oauth:2.0:oob") {
    // OOB mode — show the code inline on a follow-up page. For now we
    // route to a minimal display route.
    return `/oauth/authorize/code?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ""}`;
  }
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

function errorRedirect(redirectUri: string, state: string, code: string, description: string): string {
  if (!redirectUri || redirectUri === "urn:ietf:wg:oauth:2.0:oob") {
    return `/oauth/authorize?error=${encodeURIComponent(code)}&error_description=${encodeURIComponent(description)}`;
  }
  const url = new URL(redirectUri);
  url.searchParams.set("error", code);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
