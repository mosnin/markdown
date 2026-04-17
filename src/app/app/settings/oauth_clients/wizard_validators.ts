/**
 * Client-side validators for the OAuth client setup wizard.
 *
 * Extracted into a plain .ts module (no React) so they can be unit-
 * tested without a DOM. The server action
 * (`registerDeveloperAppAction`) re-validates on submit — these
 * helpers exist purely to give the wizard UI crisp, incremental
 * feedback.
 */

/**
 * Returns true if `uri` is an acceptable redirect URI for a browser-
 * or native-based OAuth 2.1 client:
 *
 *   - MUST parse as an absolute URL.
 *   - https:// is accepted for any host.
 *   - http:// is accepted ONLY for localhost / 127.0.0.1 / ::1
 *     (per OAuth 2.1 §4.1.2 — loopback is the one exception).
 *   - Anything else (ftp, javascript, file, custom schemes) is
 *     rejected. Custom-scheme support (for native apps) is a future
 *     extension; the server accepts them but the wizard is opinionated.
 */
export function isValidRedirectUri(uri: string): boolean {
  const trimmed = uri.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol === "http:" && isLoopback) return true;
  return false;
}

/** Diagnostic message for an invalid redirect URI. Null if valid. */
export function redirectUriError(uri: string): string | null {
  if (!uri.trim()) return "Required.";
  try {
    const u = new URL(uri.trim());
    const host = u.hostname.toLowerCase();
    const isLoopback =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]";
    if (u.protocol === "https:") return null;
    if (u.protocol === "http:" && isLoopback) return null;
    if (u.protocol === "http:") {
      return "http:// is only allowed for localhost / 127.0.0.1.";
    }
    return `Scheme ${u.protocol} is not allowed — use https:// or http://localhost.`;
  } catch {
    return "Not a valid URL.";
  }
}
