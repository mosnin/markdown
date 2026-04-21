/**
 * Client for the Cloudflare bundle cache worker (context-store-bundle-cache).
 *
 * Server-side only. Reads `BUNDLE_CACHE_SECRET` from the server env —
 * the secret must NEVER be exposed to the browser. The worker URL is
 * still read from `NEXT_PUBLIC_BUNDLE_CACHE_URL` (URLs are not
 * sensitive) but this module should only ever run server-side, as
 * context bundle assembly is a server operation.
 *
 * When `NEXT_PUBLIC_BUNDLE_CACHE_URL` is unset, all operations become
 * silent no-ops so assembly still works without the edge cache.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const CACHE_TIMEOUT_MS = 3_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getConfig(): { url: string; secret: string | undefined } | null {
  const url = process.env.NEXT_PUBLIC_BUNDLE_CACHE_URL;
  if (!url) return null;
  return { url, secret: process.env.BUNDLE_CACHE_SECRET };
}

/**
 * Build a deterministic cache key for a context bundle.
 *
 * Always incorporates `userId` so cached responses never leak between
 * users in the same workspace. When `includeUserBranches` is true, an
 * `:overlay` suffix is appended so overlay-enabled bundles live in a
 * distinct cache slot from the base (no-overlay) view.
 *
 *   bundle:${workspaceId}:${noteId}:${userId}          // no overlay
 *   bundle:${workspaceId}:${noteId}:${userId}:overlay  // overlay enabled
 */
export function bundleCacheKey(
  noteId: string,
  workspaceId: string,
  userId: string,
  includeUserBranches: boolean,
): string {
  const base = `bundle:${workspaceId}:${noteId}:${userId}`;
  return includeUserBranches ? `${base}:overlay` : base;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Retrieve a cached context bundle.
 *
 * Returns the cached value on hit, or `null` on miss / error / unconfigured.
 */
export async function getCachedBundle<T = unknown>(
  key: string,
): Promise<T | null> {
  const config = getConfig();
  if (!config) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CACHE_TIMEOUT_MS);

    const response = await fetch(`${config.url}/cache/get`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.secret
          ? { Authorization: `Bearer ${config.secret}` }
          : {}),
      },
      body: JSON.stringify({ key }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as { value: T };
    return data.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Store a context bundle in the edge cache.
 *
 * No-ops silently when the cache worker is unconfigured or unreachable.
 */
export async function setCachedBundle(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  const config = getConfig();
  if (!config) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CACHE_TIMEOUT_MS);

    await fetch(`${config.url}/cache/set`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.secret
          ? { Authorization: `Bearer ${config.secret}` }
          : {}),
      },
      body: JSON.stringify({ key, value, ttl: ttlSeconds }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch {
    // Best-effort -- don't propagate cache failures to callers
  }
}
