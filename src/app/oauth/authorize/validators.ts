/**
 * Pure validators for the OAuth authorize endpoint inputs.
 *
 * Extracted from `page.tsx` so they can be unit-tested without a
 * database or a browser. Every function is side-effect-free; all
 * network / DB calls happen in the page and server action, which
 * compose these validators with the resolved `oauth_client` row.
 *
 * Any validation failure leaves the caller with two options:
 *
 *   - If the client + redirect_uri pair validated successfully
 *     (isClientAndRedirectOk()), the page MAY 302 back to the
 *     redirect_uri with an OAuth 2.1 error=... payload.
 *   - If the client or redirect_uri is bad, the page MUST render an
 *     inline error page — we cannot safely bounce the user to an
 *     unvalidated redirect destination.
 */

import type { OAuthClient } from "@/server/services/oauth_client_service";

export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

/** Result shape for redirect-safe (pair validated) protocol errors. */
export interface RedirectableError {
  kind: "redirectable";
  error: string;
  description: string;
}

/** Result shape for non-redirectable errors (render inline). */
export interface InlineError {
  kind: "inline";
  title: string;
  message: string;
}

export type ValidationError = RedirectableError | InlineError;

/** Redirect_uri + client exist and match per OAuth 2.1 exact-string rule. */
export function isClientAndRedirectOk(
  params: AuthorizeParams,
  client: OAuthClient | null
): ValidationError | null {
  if (!params.client_id) {
    return { kind: "inline", title: "Missing client_id", message: "The OAuth request is missing a client identifier." };
  }
  if (!client) {
    return {
      kind: "inline",
      title: "Unknown client",
      // Echo the caller-supplied client_id only. Don't leak whether
      // any similar client exists or who registered them.
      message: `No OAuth client is registered with id "${params.client_id}".`,
    };
  }
  if (!params.redirect_uri) {
    return { kind: "inline", title: "Missing redirect_uri", message: "The OAuth request did not specify a redirect URI." };
  }
  // Strict exact-match per OAuth 2.1 §3.1.2.
  if (!client.redirect_uris.includes(params.redirect_uri)) {
    return {
      kind: "inline",
      title: "Redirect URI not allowed",
      message:
        "The redirect_uri sent by the app is not registered for this client. The app developer must add it to the client registration first.",
    };
  }
  return null;
}

/**
 * Validate the remaining protocol params. Call only AFTER
 * isClientAndRedirectOk() returned null. Errors returned here are
 * safe to bounce back via the validated redirect_uri.
 */
export function validateProtocolParams(params: AuthorizeParams): RedirectableError | null {
  if (params.response_type !== "code") {
    return {
      kind: "redirectable",
      error: "unsupported_response_type",
      description: "Only response_type=code is supported.",
    };
  }
  // State is required. OAuth 2.0 technically makes it RECOMMENDED, but
  // OAuth 2.1 §3.1.2.5 upgrades it to REQUIRED for CSRF prevention.
  if (!params.state || params.state.trim().length === 0) {
    return {
      kind: "redirectable",
      error: "invalid_request",
      description: "The `state` parameter is required to prevent CSRF.",
    };
  }
  if (!params.code_challenge || params.code_challenge.trim().length === 0) {
    return {
      kind: "redirectable",
      error: "invalid_request",
      description: "A PKCE `code_challenge` is required.",
    };
  }
  if (params.code_challenge_method !== "S256") {
    return {
      kind: "redirectable",
      error: "invalid_request",
      description: "PKCE `code_challenge_method` must be S256.",
    };
  }
  if (!params.scope || params.scope.trim().length === 0) {
    return {
      kind: "redirectable",
      error: "invalid_scope",
      description: "At least one scope is required.",
    };
  }
  return null;
}

/**
 * Build the OAuth-spec error redirect URL. Callers guarantee that
 * `redirectUri` came from the client's registered list — that check
 * is performed in isClientAndRedirectOk() before we reach here.
 */
export function buildErrorRedirect(
  redirectUri: string,
  state: string | null,
  error: string,
  description: string
): string {
  // OOB mode: no external URL to bounce to; render the error inline.
  if (redirectUri === "urn:ietf:wg:oauth:2.0:oob") {
    const qs = new URLSearchParams({ error, error_description: description });
    if (state) qs.set("state", state);
    return `/oauth/authorize?${qs.toString()}`;
  }
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Build the OAuth success redirect — `?code=<c>&state=<s>`.
 */
export function buildCodeRedirect(
  redirectUri: string,
  state: string,
  code: string
): string {
  if (redirectUri === "urn:ietf:wg:oauth:2.0:oob") {
    const qs = new URLSearchParams({ code });
    if (state) qs.set("state", state);
    return `/oauth/authorize/code?${qs.toString()}`;
  }
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Decide whether an existing consent row covers the set of scopes the
 * client is asking for. Used by the auto-approve path — if the user has
 * previously granted a superset of what's being requested and the client
 * is first-party, we skip the consent UI and mint a code directly.
 *
 * The comparison is set-inclusion on raw scope strings, so box
 * narrowing is honoured correctly (a consent granting boxes A+B
 * covers a new request for box A but not for box C).
 */
export function consentCoversScopes(
  grantedScopes: readonly string[],
  requestedScopes: readonly string[]
): boolean {
  if (requestedScopes.length === 0) return false;
  const set = new Set(grantedScopes);
  for (const s of requestedScopes) {
    if (!set.has(s)) return false;
  }
  return true;
}
