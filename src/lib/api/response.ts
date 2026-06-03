import { randomUUID } from "node:crypto";

// ─── Response envelope types ──────────────────────────────────────────────────

export interface ApiMeta {
  request_id: string;
  api_version: "v1";
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiError {
  error_code: string;
  message: string;
  request_id: string;
}

// ─── Response builders ────────────────────────────────────────────────────────

function makeMeta(): ApiMeta {
  return { request_id: randomUUID(), api_version: "v1" };
}

/** Wrap data in the standard success envelope and return a JSON Response. */
export function apiOk<T>(data: T, status = 200): Response {
  const body: ApiSuccess<T> = { data, meta: makeMeta() };
  return Response.json(body, { status });
}

/** Return a structured error response. */
export function apiError(
  error_code: string,
  message: string,
  status: number
): Response {
  const body: ApiError = {
    error_code,
    message,
    request_id: randomUUID(),
  };
  return Response.json(body, { status });
}

// ─── Convenience error constructors ──────────────────────────────────────────

export const E_UNAUTHORIZED = (msg = "Unauthorized — valid bearer token required") =>
  apiError("unauthorized", msg, 401);

export const E_FORBIDDEN = (msg = "Forbidden — connection does not have access to this resource") =>
  apiError("forbidden", msg, 403);

export const E_NOT_FOUND = (msg = "Not found") =>
  apiError("not_found", msg, 404);

export const E_BAD_REQUEST = (msg: string) =>
  apiError("bad_request", msg, 400);

export const E_METHOD_NOT_ALLOWED = () =>
  apiError("method_not_allowed", "Method not allowed", 405);

export const E_INTERNAL = (msg = "Internal server error") =>
  apiError("internal_error", msg, 500);

export const E_RATE_LIMITED = (retryAfterSeconds: number) =>
  apiError(
    "rate_limited",
    `Too many requests. Retry after ${retryAfterSeconds} seconds.`,
    429
  );

/**
 * 402 Payment Required — the workspace has hit a plan limit (e.g. the
 * per-period write-proposal cap). The body carries the `limit`, current
 * `used` count, and an `upgrade_url` so the caller can render an upgrade
 * prompt. This is the API surface for the service-layer paywall enforced in
 * `createProposal`; it is intentionally distinct from `rate_limited` (429),
 * which is a transient throttle, not a billing boundary.
 */
export function E_QUOTA_EXCEEDED(opts: {
  message?: string;
  limit: number;
  used: number;
  upgradeUrl: string;
}): Response {
  const body: ApiError & {
    limit: number;
    used: number;
    upgrade_url: string;
  } = {
    error_code: "quota_exceeded",
    message:
      opts.message ??
      `Plan limit reached (${opts.used}/${opts.limit}). Upgrade to continue.`,
    request_id: randomUUID(),
    limit: opts.limit,
    used: opts.used,
    upgrade_url: opts.upgradeUrl,
  };
  return Response.json(body, { status: 402 });
}

/**
 * 401 with WWW-Authenticate: Bearer error="insufficient_scope"; used by
 * every `/api/v1/**` route handler when an OAuth token is missing the
 * capability scope the route requires. The `scope` parameter advertises
 * the exact scope the caller needs, so connectors can surface a useful
 * re-authorize prompt.
 */
export function E_INSUFFICIENT_SCOPE(requiredScope: string): Response {
  const body: ApiError = {
    error_code: "insufficient_scope",
    message: `Token does not have the required scope: ${requiredScope}`,
    request_id: randomUUID(),
  };
  return new Response(JSON.stringify(body), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer realm="context-store", error="insufficient_scope", scope="${requiredScope}"`,
    },
  });
}

/**
 * 403 with a clear `forbidden_role` code — used when scope is fine but
 * the caller's workspace role (viewer) forbids the operation.
 */
export function E_FORBIDDEN_ROLE(reason = "Your workspace role does not permit this operation"): Response {
  return apiError("forbidden_role", reason, 403);
}

/**
 * 400 with a `branch_targeting_not_allowed` code — used when an
 * OAuth-backed caller tries to write against a non-main branch.
 * OAuth-backed MCP writes target main only in V1.
 */
export function E_BRANCH_TARGETING_NOT_ALLOWED(): Response {
  return apiError(
    "branch_targeting_not_allowed",
    "OAuth-backed machine writes target main only. Branch targeting is not supported over OAuth in V1; retry without a branch_id parameter.",
    400
  );
}
