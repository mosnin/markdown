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
import { createAuditEvent } from "@/server/repositories/audit_event_repository";
import { oauthAuthorizeLimit } from "@/lib/api/rate_limit";

/**
 * Server action invoked by the Approve / Deny buttons on the consent
 * screen. Performs the same validation the page did, with one extra
 * twist: the authorization code is written with the service-role
 * admin client so the subsequent token exchange (which has no user
 * session) can read it back. The user-session client is still the
 * one that gated entry — admins-only writes below are OK because we
 * verify ownership of the workspace inline.
 */

export async function approveAuthorizeAction(formData: FormData): Promise<never> {
  const clientId = String(formData.get("client_id") ?? "");
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const state = String(formData.get("state") ?? "");
  const codeChallenge = String(formData.get("code_challenge") ?? "");
  const scope = String(formData.get("scope") ?? "");
  const workspaceId = String(formData.get("workspace_id") ?? "");

  const ctx = await requireAuthenticatedUser();

  const rl = oauthAuthorizeLimit(ctx.user.id);
  if (!rl.allowed) {
    redirect(errorRedirect(redirectUri, state, "slow_down", `Too many approvals. Retry in ${rl.retryAfter}s.`));
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
  const admin = createAdminClient();
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

  // Audit the approval event with enough metadata to attribute the
  // grant later. Event type follows the existing dot-taxonomy so the
  // audit page renders it alongside other workspace events.
  await createAuditEvent(admin, {
    workspace_id: selectedWorkspace!.id,
    actor_type: "user",
    actor_id: ctx.user.id,
    object_type: "oauth_client",
    object_id: client!.id,
    event_type: "oauth.consent.approved",
    metadata: {
      client_id: client!.client_id,
      scopes: resolution.ok ? resolution.scopes : [],
    },
  });

  redirect(codeRedirect(redirectUri, state, issued.code));
}

export async function denyAuthorizeAction(formData: FormData): Promise<never> {
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const state = String(formData.get("state") ?? "");
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
