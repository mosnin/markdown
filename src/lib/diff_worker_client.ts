/**
 * Client for the Cloudflare diff worker (context-store-diff).
 *
 * When NEXT_PUBLIC_DIFF_WORKER_URL is set, offloads diff computation
 * to the edge. Falls back to null so callers can use the local `diff`
 * library instead.
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
 *   - NEXT_PUBLIC_DIFF_WORKER_URL is not configured
 *   - The worker is unreachable or returns an error
 *   - The request times out (3 s)
 *
 * Callers should fall back to the local `diff` library when null is returned.
 */
export async function computeDiffViaWorker(
  before: string | null,
  after: string | null,
  mode?: "words" | "lines",
): Promise<DiffResult | null> {
  const workerUrl = process.env.NEXT_PUBLIC_DIFF_WORKER_URL;
  if (!workerUrl) return null;

  const secret = process.env.NEXT_PUBLIC_DIFF_WORKER_SECRET;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);

    const response = await fetch(`${workerUrl}/diff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ before, after, mode }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as DiffResult;
    return data;
  } catch {
    // Network error, timeout, or parse failure -- caller falls back
    return null;
  }
}
