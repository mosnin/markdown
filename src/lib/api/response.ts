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
