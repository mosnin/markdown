import type { Event, Breadcrumb } from "@sentry/nextjs";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization", "cookie", "set-cookie", "x-api-key",
  "x-workspace-operator-secret", "x-webhook-signature",
]);

const SENSITIVE_QUERY_PARAMS = new Set(["token", "code", "access_token", "refresh_token", "secret"]);

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9_\-.]+/gi;
const CSK_RE = /csk_v1_[A-Za-z0-9_\-]+/g;

function redactString(s: string): string {
  return s
    .replace(BEARER_RE, "Bearer <redacted>")
    .replace(CSK_RE, "csk_v1_<redacted>")
    .replace(EMAIL_RE, "<email>");
}

function redactHeaders(headers: Record<string, unknown> | undefined) {
  if (!headers) return headers;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER_NAMES.has(k.toLowerCase())
      ? "<redacted>"
      : typeof v === "string" ? redactString(v) : v;
  }
  return out;
}

function redactUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    for (const p of Array.from(u.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAMS.has(p.toLowerCase())) u.searchParams.set(p, "<redacted>");
    }
    return u.toString();
  } catch { return url; }
}

export function scrubEvent(event: Event): Event | null {
  if (event.request) {
    event.request.headers = redactHeaders(event.request.headers as Record<string, unknown>) as Record<string, string>;
    if (event.request.url) event.request.url = redactUrl(event.request.url);
    if (typeof event.request.data === "string") event.request.data = redactString(event.request.data);
  }
  if (event.message) event.message = redactString(event.message);
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value) ex.value = redactString(ex.value);
    }
  }
  // Never send user email
  if (event.user) {
    event.user = { id: event.user.id };
  }
  return event;
}

export function scrubBreadcrumb(b: Breadcrumb): Breadcrumb | null {
  if (b.data) {
    const d = b.data as Record<string, unknown>;
    if (typeof d.url === "string") d.url = redactUrl(d.url);
    if (d.headers) d.headers = redactHeaders(d.headers as Record<string, unknown>);
  }
  if (b.message) b.message = redactString(b.message);
  return b;
}
