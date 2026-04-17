import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  AlertTriangle,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { getRequestContext } from "@/server/auth/get_request_context";
import { createClient } from "@/lib/supabase/server";
import {
  getOAuthClientByClientId,
} from "@/server/services/oauth_client_service";
import {
  parseScopeString,
  resolveGrantedScopes,
  splitScopes,
  isCapabilityScope,
  type OAuthCapabilityScope,
} from "@/server/services/oauth_scope_service";
import {
  SCOPE_DESCRIPTIONS,
  SCOPE_GROUP_LABELS,
  anyWriteCapable,
  groupScopes,
} from "@/lib/oauth_scope_descriptions";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { listAccessibleWorkspaces } from "@/server/repositories/workspace_membership_repository";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AuthorizeConsentForm } from "./consent_form";
import {
  buildErrorRedirect,
  buildCodeRedirect,
  consentCoversScopes,
  isClientAndRedirectOk,
  validateProtocolParams,
  type AuthorizeParams,
} from "./validators";
import { issueAuthorizationCode } from "@/server/services/oauth_token_service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

/**
 * OAuth 2.1 authorization endpoint (user-facing).
 *
 * Flow:
 *
 *   1. Require an authenticated Context Store session — if the user is
 *      not signed in, redirect to /sign_in?next=<authorize_url> so the
 *      sign-in page bounces back here after auth.
 *   2. Validate everything BEFORE asking the user anything:
 *        - client_id must resolve to an active client row.
 *        - redirect_uri must be in client.redirect_uris exactly (no
 *          wildcards, no prefix match).
 *        - response_type=code, code_challenge + S256, state required.
 *        - scope string must parse and intersect with allowed_scopes.
 *      Malformed request = inline error page. Protocol error against
 *      a valid (client, redirect) pair = 302 back with OAuth error=.
 *      Never redirect malformed requests to the caller — that is a
 *      phishing hazard.
 *   3. If a valid oauth_consents row covers all requested scopes AND
 *      the client is first-party, auto-approve: mint the code, 302
 *      back with ?code=&state=. This is the "seamless reconnect"
 *      path — e.g. Claude Desktop re-auth after its refresh token
 *      expired.
 *   4. Otherwise render the consent UI.
 *
 * Security notes:
 *
 *   - Error pages never echo internal identifiers beyond what the
 *     caller already supplied (the same client_id or redirect_uri).
 *   - Error pages include a "return to app" affordance only when the
 *     redirect_uri is validated; for malformed requests we offer a
 *     home link and no automated bounce.
 */

interface PageProps {
  searchParams: Promise<AuthorizeParams & {
    error?: string;
    error_description?: string;
  }>;
}

export default async function AuthorizePage({ searchParams }: PageProps) {
  const params = await searchParams;

  // OOB error display: if we were bounced back here with ?error=... it
  // means buildErrorRedirect() couldn't reach a real callback (OOB mode
  // or missing redirect_uri). Render the error and stop.
  if (params.error) {
    return (
      <AuthorizeErrorPage
        title={oauthErrorTitle(params.error)}
        message={params.error_description ?? "The OAuth request could not be completed."}
        returnHref={null}
      />
    );
  }

  // ─── Step 1: authentication ────────────────────────────────────────────────
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    // Preserve the full authorize URL in ?next= so sign-in can bounce
    // the user back into the consent screen once they authenticate.
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === "string" && v.length > 0) qs.set(k, v);
    }
    const next = `/oauth/authorize?${qs.toString()}`;
    redirect(`/sign_in?next=${encodeURIComponent(next)}`);
  }

  // ─── Step 2: client + redirect_uri (inline-error gate) ─────────────────────
  const supabase = await createClient();
  const client = params.client_id
    ? await getOAuthClientByClientId(supabase, params.client_id)
    : null;
  const clientGateError = isClientAndRedirectOk(params, client);
  if (clientGateError) {
    return (
      <AuthorizeErrorPage
        title={clientGateError.kind === "inline" ? clientGateError.title : "Invalid request"}
        message={clientGateError.kind === "inline" ? clientGateError.message : ""}
        returnHref={null}
      />
    );
  }
  // client + redirect_uri confirmed; from here on, protocol errors can
  // 302 back to the caller.
  const redirectUri = params.redirect_uri!;
  const state = params.state ?? null;

  // ─── Step 3: remaining protocol params ─────────────────────────────────────
  const protoError = validateProtocolParams(params);
  if (protoError) {
    redirect(buildErrorRedirect(redirectUri, state, protoError.error, protoError.description));
  }

  // ─── Step 4: scope resolution ──────────────────────────────────────────────
  const requestedScopes = parseScopeString(params.scope);
  if (requestedScopes.length === 0) {
    redirect(buildErrorRedirect(redirectUri, state, "invalid_scope", "No valid scopes in request."));
  }
  const accessibleBoxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);
  const accessibleBoxIdSet = new Set(accessibleBoxes.map((b) => b.id));

  const resolution = resolveGrantedScopes({
    requested: requestedScopes,
    clientAllowed: client!.allowed_scopes.filter(isCapabilityScope) as OAuthCapabilityScope[],
    role: ctx.workspace.role,
    accessibleBoxIds: accessibleBoxIdSet,
  });
  if (!resolution.ok) {
    // A scope the client is not registered for, or the user can't
    // grant, or a box the user can't reach. This can go back to the
    // client — an attacker can learn nothing useful here.
    redirect(buildErrorRedirect(redirectUri, state, "invalid_scope", resolution.error));
  }
  const grantableScopes = resolution.scopes;

  // ─── Step 5: auto-approve if a covering consent already exists ─────────────
  // Only first-party clients auto-approve; a third-party re-auth always
  // shows the consent screen so the user can see what's happening.
  if (client!.is_first_party) {
    const { data: existingConsent } = await supabase
      .from("oauth_consents")
      .select("id, scopes, revoked_at")
      .eq("user_id", ctx.user.id)
      .eq("client_id", client!.client_id)
      .eq("workspace_id", ctx.workspace.id)
      .is("revoked_at", null)
      .maybeSingle();

    if (
      existingConsent &&
      consentCoversScopes(existingConsent.scopes ?? [], grantableScopes)
    ) {
      // Mint a code via the admin client (same pattern as the server
      // action); the subsequent token exchange has no user session.
      const admin = createAdminClient();
      const issued = await issueAuthorizationCode(admin, {
        clientId: client!.client_id,
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        redirectUri,
        scope: grantableScopes,
        codeChallenge: params.code_challenge!,
      });
      await createAuditEvent(admin, {
        workspace_id: ctx.workspace.id,
        actor_type: "user",
        actor_id: ctx.user.id,
        object_type: "oauth_client",
        object_id: client!.id,
        event_type: "oauth.consent.auto_approved",
        metadata: {
          client_id: client!.client_id,
          scopes: grantableScopes,
        },
      });
      redirect(buildCodeRedirect(redirectUri, state ?? "", issued.code));
    }
  }

  // ─── Step 6: render the consent UI ─────────────────────────────────────────
  const { capabilities: capabilityScopes, boxIds: requestedBoxIds } =
    splitScopes(grantableScopes);
  const defaultBoxIds = requestedBoxIds ?? accessibleBoxIdSet;
  const accessible = await listAccessibleWorkspaces(supabase, ctx.user.id);
  const groups = groupScopes(grantableScopes);
  const hasAnyWrite = anyWriteCapable(grantableScopes);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="rounded-xl border border-border bg-card shadow-sm">
          {/* ── App identity ──────────────────────────────────────────────── */}
          <header className="flex flex-col items-center gap-3 border-b border-border px-6 pt-6 pb-5 text-center">
            {client!.logo_url ? (
              <Image
                src={client!.logo_url}
                alt=""
                width={56}
                height={56}
                className="rounded-lg"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-accent text-xl font-semibold text-accent-foreground">
                {client!.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                {client!.name} wants to connect to your workspace
              </h1>
              {client!.description && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {client!.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                {client!.is_first_party ? (
                  <Badge variant="success" className="gap-1 text-[10px]">
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                    Verified first-party
                  </Badge>
                ) : (
                  <Badge variant="warning" className="gap-1 text-[10px]">
                    <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                    Third-party app
                  </Badge>
                )}
                {client!.homepage_url && (
                  <a
                    href={client!.homepage_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Homepage
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
          </header>

          <div className="px-6 py-5 space-y-5">
            {/* ── Workspace ─────────────────────────────────────────────── */}
            <section>
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Workspace
              </h2>
              <div className="mt-2 rounded-md border border-border bg-background px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {ctx.workspace.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Access is limited to this workspace only.
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {ctx.workspace.role}
                  </Badge>
                </div>
                {accessible.length > 1 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    To authorize a different workspace,{" "}
                    <Link
                      href={`/app/workspaces?returnTo=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams({
                        response_type: "code",
                        client_id: client!.client_id,
                        redirect_uri: redirectUri,
                        scope: params.scope ?? "",
                        state: state ?? "",
                        code_challenge: params.code_challenge ?? "",
                        code_challenge_method: "S256",
                      }).toString()}`)}`}
                      className="underline hover:text-foreground"
                    >
                      switch workspace
                    </Link>
                    , then return.
                  </p>
                )}
              </div>
            </section>

            <Separator />

            {/* ── Scopes ────────────────────────────────────────────────── */}
            <section>
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                What {client!.name} will be able to do
              </h2>
              <div className="mt-3 space-y-4">
                {(["read", "propose", "generate", "branch"] as const).map((g) => {
                  const bucket = groups[g];
                  if (bucket.length === 0) return null;
                  const badgeLabel =
                    g === "read" ? "Read" :
                    g === "propose" ? "Propose" :
                    g === "branch" ? "Branch" :
                    "Write";
                  return (
                    <div key={g}>
                      <p className="text-[11px] font-medium text-muted-foreground">
                        {SCOPE_GROUP_LABELS[g]}
                      </p>
                      <ul className="mt-1.5 flex flex-col gap-2 list-none">
                        {bucket.map((s) => {
                          const d = SCOPE_DESCRIPTIONS[s];
                          return (
                            <li
                              key={s}
                              className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2"
                            >
                              <Badge
                                variant={d.badgeVariant}
                                className="mt-0.5 shrink-0 text-[10px]"
                              >
                                {badgeLabel}
                              </Badge>
                              <div className="min-w-0">
                                <p className="text-sm font-medium">{d.title}</p>
                                <p className="text-xs text-muted-foreground">
                                  {d.description}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
                {groups.narrow.length > 0 && (
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">
                      Limited to specific boxes
                    </p>
                    <ul className="mt-1.5 flex flex-wrap gap-1 list-none">
                      {groups.narrow.map((id) => {
                        const box = accessibleBoxes.find((b) => b.id === id);
                        return (
                          <li key={id}>
                            <Badge variant="info" className="text-[10px]">
                              {box?.name ?? `Box ${id.slice(0, 8)}…`}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>

              {hasAnyWrite && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                  <p className="text-xs text-warning">
                    This app can propose or generate content in your
                    workspace. Review the scopes above carefully before
                    approving.
                  </p>
                </div>
              )}
            </section>

            <Separator />

            {/* ── Signed-in user ────────────────────────────────────────── */}
            <section>
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
                <UserCheck
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>
                  Signed in as{" "}
                  <span className="font-medium">
                    {ctx.user.email ?? "Authenticated user"}
                  </span>
                </span>
              </div>
            </section>

            {/* ── Consent form ──────────────────────────────────────────── */}
            <AuthorizeConsentForm
              clientId={client!.client_id}
              redirectUri={redirectUri}
              state={state ?? ""}
              codeChallenge={params.code_challenge ?? ""}
              capabilityScopes={capabilityScopes}
              boxes={accessibleBoxes.map((b) => ({ id: b.id, name: b.name }))}
              defaultBoxIds={Array.from(defaultBoxIds)}
              connectorRequestedBoxIds={
                requestedBoxIds ? Array.from(requestedBoxIds) : null
              }
              workspaces={accessible.map((w) => ({
                id: w.id,
                name: w.name,
                role: w.role,
              }))}
              activeWorkspaceId={ctx.workspace.id}
            />

            {/* ── Legal / lifetime copy ─────────────────────────────────── */}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Approving creates a 1-hour access token and a 30-day refresh
              token, rotated each time it&apos;s used. You can revoke this
              connector&apos;s access at any time from{" "}
              <Link
                href="/app/settings/connected_apps"
                className="underline hover:text-foreground"
              >
                Settings → Connected apps
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Polished error page for malformed or denied OAuth requests.
 *
 * Deliberately minimal: state the problem, offer a safe way out, don't
 * leak internals. When a valid `returnHref` is known we offer a
 * "Return to app" button; when not we offer "Go home".
 */
function AuthorizeErrorPage({
  title,
  message,
  returnHref,
}: {
  title: string;
  message: string;
  returnHref: string | null;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-6 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
          <ShieldAlert
            className="h-5 w-5 text-destructive"
            aria-hidden="true"
          />
        </div>
        <h1 className="text-base font-semibold text-destructive">{title}</h1>
        {message && (
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        )}
        <div className="mt-4 flex justify-center gap-2">
          {returnHref ? (
            <Button size="sm" render={<a href={returnHref} />}>
              Return to app
            </Button>
          ) : (
            <Button size="sm" render={<a href="/app" />}>Go home</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function oauthErrorTitle(code: string): string {
  switch (code) {
    case "access_denied":
      return "Access denied";
    case "invalid_scope":
      return "Invalid scope";
    case "invalid_request":
      return "Invalid request";
    case "unsupported_response_type":
      return "Unsupported response type";
    case "invalid_client":
      return "Unknown client";
    default:
      return "Authorization failed";
  }
}
