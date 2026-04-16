/**
 * Hydration-safe date formatting helpers.
 *
 * Background
 * ----------
 * Rendering dates with `new Date(iso).toLocaleDateString()` (no explicit
 * locale) or computing relative strings against an in-render `new Date()`
 * produces different output on the server vs. the client, because:
 *
 *   1. The user's OS locale differs from the server's — a bare
 *      `toLocaleDateString()` call emits `M/D/YYYY` on US systems and
 *      `DD/MM/YYYY` elsewhere.
 *   2. `Date.now()` on the server vs. the client's hydration tick are
 *      never exactly equal, so any relative string ("2 days ago") may
 *      straddle a boundary and differ.
 *
 * Both cases trigger React hydration mismatch warnings and, in some
 * patterns, full client re-renders.
 *
 * Contract
 * --------
 * - `formatAbsoluteDate(iso)` always emits the exact same string on
 *   server and client by pinning the locale to `'en-US'` and using a
 *   stable `{ month: 'short', day: 'numeric', year: 'numeric' }` recipe.
 *   Use for "Jan 15, 2026" style metadata.
 *
 * - `formatRelativeDate(iso, nowIso)` takes an explicit `now` timestamp
 *   so the caller (typically a server component) can freeze it at
 *   render time and pass it through as a prop / closed-over constant.
 *   This guarantees server and client compute identical relative
 *   strings during hydration. Fallback absolute formatting is also
 *   pinned to `'en-US'`.
 */

/** Locale-stable absolute date — e.g. "Jan 15, 2026". */
export function formatAbsoluteDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

/**
 * Locale-stable relative date with an explicit `now`. `nowIso` MUST be
 * passed by the caller so the value is identical on server and client
 * during hydration. Examples:
 *   "Today", "Yesterday", "3 days ago", "Jan 15, 2026"
 */
export function formatRelativeDate(iso: string, nowIso: string): string {
  const now = new Date(nowIso);
  const d = new Date(iso);
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return formatAbsoluteDate(iso);
}

/**
 * Extended relative formatter that also bucket-emits "N weeks ago"
 * before falling back to "Jan 15" (no year). Matches the dashboard's
 * original format — kept separate so the simpler formatter stays terse.
 */
export function formatRelativeDateShort(iso: string, nowIso: string): string {
  const now = new Date(nowIso);
  const d = new Date(iso);
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(d);
}
