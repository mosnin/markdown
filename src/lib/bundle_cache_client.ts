/**
 * Client for the Cloudflare bundle cache worker (context-store-bundle-cache).
 *
 * When NEXT_PUBLIC_BUNDLE_CACHE_URL is set, provides KV-backed caching
 * for context bundle assembly results. No-ops when unconfigured.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const CACHE_TIMEOUT_MS = 3_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getConfig(): { url: string; secret: string | undefined } | null {
  const url = process.env.NEXT_PUBLIC_BUNDLE_CACHE_URL;
  if (!url) return null;
  return { url, secret: process.env.NEXT_PUBLIC_BUNDLE_CACHE_SECRET };
}

/**
 * Build a deterministic cache key for a context bundle.
 *
 * Includes branchId so branch-aware bundles never serve stale main data.
 */
export function bundleCacheKey(
  noteId: string,
  workspaceId: string,
  branchId?: string | null,
): string {
  const base = `bundle:${workspaceId}:${noteId}`;
  return branchId ? `${base}:${branchId}` : base;
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
