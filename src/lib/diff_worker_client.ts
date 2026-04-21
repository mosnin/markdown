/**
 * Client for the Cloudflare diff worker (context-store-diff).
 *
 * Dual-mode client:
 *   - In the browser, POSTs to the app's server-side proxy route
 *     `/api/internal/diff` so the worker secret never leaves the server.
 *   - On the server (SSR, route handlers, services), calls the Cloudflare
 *     worker directly with the server-only `DIFF_WORKER_SECRET` bearer.
 *
 * Either path may return `null` when the worker is unreachable, misconfigured,
 * or times out — callers should fall back to the local `diff` library.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DiffResult {
  parts: Array<{ value: string; added?: boolean; removed?: boolean }>;
  fallback: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const WORKER_TIMEOUT_MS = 3_000;

// ─── Client ─────────────────────────────────────────────────────────────────

/**
 * Compute a prose diff via the Cloudflare edge worker.
 *
 * Returns the diff result on success, or `null` if:
 *   - The worker URL (server-side path) is not configured
 *   - The worker / proxy is unreachable or returns an error
 *   - The request times out (3 s)
 *
 * Callers should fall back to the local `diff` library when null is returned.
 */
export async function computeDiffViaWorker(
  before: string | null,
  after: string | null,
  mode?: "words" | "lines",
): Promise<DiffResult | null> {
  const isBrowser = typeof window !== "undefined";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);

    let response: Response;

    if (isBrowser) {
      // Browser path: go through the server-side proxy so the worker
      // secret is never exposed in the bundle. The proxy enforces auth,
      // size limits, and forwards with the secret server-side.
      response = await fetch(`/api/internal/diff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ before, after, mode }),
        signal: controller.signal,
      });
    } else {
      // Server path: call the Cloudflare worker directly with the
      // server-only bearer secret.
      const workerUrl = process.env.NEXT_PUBLIC_DIFF_WORKER_URL;
      if (!workerUrl) {
        clearTimeout(timeout);
        return null;
      }
      const secret = process.env.DIFF_WORKER_SECRET;

      response = await fetch(`${workerUrl}/diff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        },
        body: JSON.stringify({ before, after, mode }),
        signal: controller.signal,
      });
    }

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as DiffResult;
    return data;
  } catch {
    // Network error, timeout, or parse failure -- caller falls back
    return null;
  }
}
