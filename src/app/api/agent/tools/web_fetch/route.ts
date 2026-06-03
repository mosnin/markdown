import { type NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

/**
 * POST /api/agent/tools/web_fetch
 *
 * Internal endpoint invoked by the Workspace Operator. Fetches a public
 * URL on behalf of the agent and returns the body as plaintext, stripped
 * of HTML tags and capped at 32 KB.
 *
 * SSRF guard: only http/https schemes are accepted; loopback, link-local,
 * and RFC1918 hosts are refused. The agent has no direct network egress
 * to arbitrary URLs — every external fetch goes through this proxy so the
 * trust boundary stays on the Next.js side.
 *
 * Body: { url: string }
 * Returns: { url, final_url, status, content_type, text, truncated }
 */

const MAX_BYTES = 32 * 1024; // 32 KB cap on returned text
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Classify a dotted-decimal IPv4 string as private / loopback / link-local
 * / reserved. Returns false for anything that isn't four valid decimal
 * octets or is a routable public address. Shared by the plain-IPv4 path and
 * the IPv4-mapped-IPv6 path below so both apply identical ranges.
 *
 * Note: Node's `URL` constructor already normalizes integer (2130706433),
 * hex (0x7f000001), and octal (0177.0.0.1) IPv4 forms to dotted-decimal
 * before `hostname` is read, so this single check covers those
 * obfuscations too.
 */
function isPrivateIpv4(dotted: string): boolean {
  const m = dotted.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
  if (a > 255 || b > 255) return false; // not a valid octet — treat as non-IP
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local + cloud metadata)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 0) return true; // 0.0.0.0/8
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // Loopback / null aliases
  if (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "0.0.0.0" ||
    lower === "::1" ||
    lower === "[::1]"
  ) {
    return true;
  }

  // Plain IPv4 (incl. integer/hex/octal forms normalized by URL parsing).
  if (isPrivateIpv4(lower)) return true;

  // IPv4-mapped / IPv4-compatible IPv6 (e.g. ::ffff:169.254.169.254 or its
  // hex form ::ffff:a9fe:a9fe). Without this, a private or cloud-metadata
  // IPv4 address smuggled inside an IPv6 literal would slip past the IPv4
  // ranges above — on a dual-stack host the OS routes ::ffff:a.b.c.d to the
  // IPv4 destination. Strip brackets, then re-check any embedded dotted-quad
  // and fold the hex-encoded mapped form back to dotted-decimal.
  const v6 = lower.replace(/^\[/, "").replace(/\]$/, "");
  if (v6.includes(":")) {
    // a) Embedded dotted-quad form: ::ffff:169.254.169.254
    const dottedTail = v6.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (dottedTail && isPrivateIpv4(dottedTail[1])) return true;
    // b) Hex-encoded mapped form: ::ffff:a9fe:a9fe → 169.254.169.254
    const hexMapped = v6.match(/:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      if (isPrivateIpv4(dotted)) return true;
    }
  }

  // Crude IPv6 private/loopback checks
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("[fc") || lower.startsWith("[fd") || lower.startsWith("[fe80")) {
    return true;
  }

  // .internal / .local / .localhost mDNS-ish
  if (
    lower.endsWith(".internal") ||
    lower.endsWith(".local") ||
    lower.endsWith(".localhost")
  ) {
    return true;
  }

  return false;
}

interface SsrfCheckResult {
  ok: boolean;
  reason?: string;
}

export function ssrfCheck(rawUrl: string): SsrfCheckResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "url is not a valid absolute URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `unsupported scheme: ${parsed.protocol}` };
  }
  if (!parsed.hostname) {
    return { ok: false, reason: "url has no hostname" };
  }
  if (isPrivateHostname(parsed.hostname)) {
    return { ok: false, reason: `hostname ${parsed.hostname} is not allowed` };
  }
  return { ok: true };
}

function stripHtml(html: string): string {
  // Remove script/style blocks, then all tags. Conservative; not a real parser.
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const noTags = noScripts.replace(/<[^>]+>/g, " ");
  return noTags.replace(/\s+/g, " ").trim();
}

export async function POST(request: NextRequest) {
  const auth = verifyAgentRequest(request);
  if (!auth.ok) {
    switch (auth.failure.kind) {
      case "feature_disabled":
        return apiError("feature_disabled", "Workspace Operator is not enabled", 404);
      case "missing_secret":
        return apiError("server_misconfigured", "Shared secret is not configured", 500);
      case "invalid_secret":
        return apiError("unauthorized", "Invalid shared secret", 401);
      case "missing_envelope":
        return E_BAD_REQUEST(`Missing required header: ${auth.failure.field}`);
      case "invalid_envelope":
        return E_BAD_REQUEST(
          `Invalid ${auth.failure.field}: ${auth.failure.reason}`
        );
    }
  }
  const { ctx } = auth;

  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { url } = body;
  if (typeof url !== "string" || !url.trim()) {
    return E_BAD_REQUEST("url is required and must be a non-empty string");
  }

  const guard = ssrfCheck(url);
  if (!guard.ok) {
    return apiError("forbidden_url", guard.reason ?? "url is not allowed", 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "PoggleWorkspaceOperator/1.0 (+https://poggle.app)",
        accept: "text/html, text/plain, application/xhtml+xml, */*;q=0.5",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    return apiError("fetch_failed", `Failed to fetch URL: ${message}`, 502);
  }
  clearTimeout(timer);

  // Re-check the final URL after redirects to defeat redirect-based SSRF.
  if (response.url) {
    const finalGuard = ssrfCheck(response.url);
    if (!finalGuard.ok) {
      return apiError(
        "forbidden_url",
        `redirect target not allowed: ${finalGuard.reason}`,
        400
      );
    }
  }

  const contentType = response.headers.get("content-type");
  const buffer = await response.arrayBuffer();
  const truncated = buffer.byteLength > MAX_BYTES;
  const slice = truncated ? buffer.slice(0, MAX_BYTES) : buffer;
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(slice);

  const isHtml =
    !!contentType &&
    (contentType.includes("text/html") ||
      contentType.includes("application/xhtml"));
  const text = isHtml ? stripHtml(raw) : raw;

  return apiOk({
    run_id: ctx.runId,
    url,
    final_url: response.url || url,
    status: response.status,
    content_type: contentType,
    text,
    truncated,
  });
}
