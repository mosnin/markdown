import { redirect } from "next/navigation";
import Image from "next/image";
import { ShieldCheck, Lock, UserCheck } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getOAuthClientByClientId, isRedirectUriAllowed } from "@/server/services/oauth_client_service";
import {
  parseScopeString,
  resolveGrantedScopes,
  splitScopes,
  OAUTH_SCOPES,
  isCapabilityScope,
  type OAuthCapabilityScope,
} from "@/server/services/oauth_scope_service";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { listAccessibleWorkspaces } from "@/server/repositories/workspace_membership_repository";
import { AuthorizeConsentForm } from "./consent_form";

/**
 * OAuth authorization (consent) page.
 *
 * Arrived at by the connector sending the user to
 *   /oauth/authorize?response_type=code&client_id=...&redirect_uri=...
 *   &scope=...&state=...&code_challenge=...&code_challenge_method=S256
 *
 * Behaviour:
 *
 *   1. Require an authenticated Context Store session (redirect to
 *      /sign_in with return=here if not signed in).
 *   2. Validate every OAuth param before asking the user anything — a
 *      bad client_id or unregistered redirect_uri must never produce a
 *      consent prompt, because the attacker controls the redirect.
 *   3. Resolve the requested scope against the client's allowlist and
 *      the user's workspace role. Scopes the user cannot grant (e.g.
 *      a viewer asked for context:generate) are surfaced explicitly;
 *      the user can still proceed with the reduced set if they want.
 *   4. Render the consent UI listing: requesting app, scopes, workspace
 *      selector, Approve / Deny.
 *   5. Approve posts to the server action in ./actions.ts which mints
 *      the authorization code and redirects back to redirect_uri with
 *      code+state.
 *   6. Deny redirects back to redirect_uri with error=access_denied.
 */

function buildErrorRedirect(redirectUri: string | null, state: string | null, code: string, description: string) {
  if (!redirectUri) {
    // No valid redirect_uri means we cannot safely bounce — render an
    // inline error.
    return null;
  }
  const url = new URL(redirectUri);
  url.searchParams.set("error", code);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

interface SearchParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  // Step 1: any authenticated user with a workspace. OAuth consent is
  // a logged-in action — anonymous callers are bounced to sign_in.
  const ctx = await requireAuthenticatedUser();

  // Step 2: validate client and redirect_uri BEFORE anything else so a
  // malicious caller cannot trigger a bad redirect.
  const clientId = params.client_id;
  const redirectUri = params.redirect_uri ?? null;
  const state = params.state ?? null;

  if (!clientId) return <InlineError title="Missing client_id" />;
  if (!redirectUri) return <InlineError title="Missing redirect_uri" />;

  const supabase = await createClient();
  const client = await getOAuthClientByClientId(supabase, clientId);
  if (!client) return <InlineError title="Unknown client" message={`No OAuth client registered with id "${clientId}".`} />;
  if (!isRedirectUriAllowed(client, redirectUri)) {
    return <InlineError title="Redirect URI not allowed" message="The redirect_uri is not registered for this client." />;
  }

  // From here, we have a valid client and redirect_uri — any further
  // protocol errors go back via the redirect.
  if (params.response_type !== "code") {
    const dest = buildErrorRedirect(redirectUri, state, "unsupported_response_type", "Only response_type=code is supported.");
    if (dest) redirect(dest);
  }
  if (!params.code_challenge || params.code_challenge_method !== "S256") {
    const dest = buildErrorRedirect(redirectUri, state, "invalid_request", "PKCE with S256 is required.");
    if (dest) redirect(dest);
  }

  // Step 3: resolve scopes against client allowlist + user role.
  const requestedScopes = parseScopeString(params.scope);
  if (requestedScopes.length === 0) {
    const dest = buildErrorRedirect(redirectUri, state, "invalid_scope", "At least one scope is required.");
    if (dest) redirect(dest);
  }
  // Fetch every box in the active workspace so (a) the consent UI can
  // offer per-box narrowing and (b) resolveGrantedScopes can reject
  // box scopes for boxes the user cannot reach.
  const accessibleBoxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);
  const accessibleBoxIdSet = new Set(accessibleBoxes.map((b) => b.id));

  const resolution = resolveGrantedScopes({
    requested: requestedScopes,
    clientAllowed: client.allowed_scopes.filter(isCapabilityScope) as OAuthCapabilityScope[],
    role: ctx.workspace.role,
    accessibleBoxIds: accessibleBoxIdSet,
  });
  if (!resolution.ok) {
    const dest = buildErrorRedirect(redirectUri, state, "invalid_scope", resolution.error);
    if (dest) redirect(dest);
  }
  const grantableScopes = resolution.ok ? resolution.scopes : [];
  // Capability-vs-box split used by the UI and by the server action.
  const { capabilities: capabilityScopes, boxIds: requestedBoxIds } =
    splitScopes(grantableScopes);
  // Connectors that didn't ask for specific boxes get workspace-wide
  // by default; in the UI we still show every box so the user can
  // narrow the grant before approving.
  const defaultBoxIds = requestedBoxIds ?? accessibleBoxIdSet;

  // Step 4: list the workspaces this user can authorize the connector
  // for. Default to the active workspace; the user can change it.
  const accessible = await listAccessibleWorkspaces(supabase, ctx.user.id);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-col items-center gap-3 border-b border-border px-6 pt-6 pb-5 text-center">
            {client.logo_url ? (
              <Image
                src={client.logo_url}
                alt={`${client.name} logo`}
                width={48}
                height={48}
                className="rounded-lg"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-xl font-semibold text-accent-foreground">
                {client.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                {client.name} wants to connect
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {client.description ?? "An MCP-compatible connector is requesting access."}
              </p>
              {client.is_first_party && (
                <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-foreground">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  Trusted first-party connector
                </div>
              )}
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">
            <section>
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                What it will be able to do
              </h2>
              <ul className="mt-2 flex flex-col gap-2 list-none">
                {capabilityScopes.map((s) => (
                  <li key={s} className="flex items-start gap-2 text-sm">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div>
                      <p className="font-medium">{OAUTH_SCOPES[s].label}</p>
                      <p className="text-xs text-muted-foreground">{OAUTH_SCOPES[s].description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Signed in as
              </h2>
              <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
                <UserCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span>{ctx.user.email ?? "Authenticated user"}</span>
              </div>
            </section>

            <AuthorizeConsentForm
              clientId={client.client_id}
              redirectUri={redirectUri}
              state={state ?? ""}
              codeChallenge={params.code_challenge ?? ""}
              capabilityScopes={capabilityScopes}
              boxes={accessibleBoxes.map((b) => ({ id: b.id, name: b.name }))}
              defaultBoxIds={Array.from(defaultBoxIds)}
              // When the connector explicitly requested box ids we
              // don't let the user add boxes beyond that set — only
              // narrow further. When they didn't, the user is free to
              // choose any subset.
              connectorRequestedBoxIds={requestedBoxIds ? Array.from(requestedBoxIds) : null}
              workspaces={accessible.map((w) => ({
                id: w.id,
                name: w.name,
                role: w.role,
              }))}
              activeWorkspaceId={ctx.workspace.id}
            />
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          You can revoke this connector&apos;s access any time from
          {" "}
          <a href="/app/settings#settings-connections" className="underline">
            Settings → Connected apps
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function InlineError({ title, message }: { title: string; message?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-6 text-center">
        <h1 className="text-base font-semibold text-destructive">{title}</h1>
        {message && <p className="mt-1 text-sm text-muted-foreground">{message}</p>}
      </div>
    </div>
  );
}
