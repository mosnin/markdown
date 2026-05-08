import { type HybridSearchResult } from "@/server/services/embedding_service";

/**
 * Search rerank service — multi-stage reranking on top of `hybridSearch`.
 *
 * Background: `hybridSearch` returns a blend of keyword FTS (0.3) and vector
 * similarity (0.7). That signal is solid for short queries but degrades on
 * multi-concept queries and on workspaces with many similar notes. This
 * service takes the top-N candidates from `hybridSearch` and reorders them
 * using a small set of cheap, deterministic signals:
 *
 *   - Original hybrid score (weight 0.4)
 *   - Title match boost: +0.15 if any query term appears in the note title
 *   - Recency decay: linear over 90 days, weight 0.1 (gentle freshness tilt)
 *   - Link-graph boost: +0.05 per inbound link from another high-scoring
 *     candidate (encourages clusters of related, well-connected notes)
 *   - Tag overlap: +0.10 if any query term matches a note tag
 *
 * Design notes:
 *   - Pure function. No DB calls, no I/O. The caller (today only
 *     `embedding_service.hybridSearch`) is responsible for fetching the
 *     supplemental metadata (titles are already on `HybridSearchResult`,
 *     but tags / updated_at / link graph are passed in via `opts`).
 *   - Deterministic. The function signature reserves an `opts.crossEncoder`
 *     hook for a future LLM/cross-encoder pass; in v1 it is unused.
 *   - Tolerant of missing metadata: if a map is omitted or a noteId isn't
 *     present, the corresponding signal contributes 0.
 *   - Top-N candidates considered: 20 (`RERANK_CANDIDATES`). The default
 *     return limit is 10 (`DEFAULT_LIMIT`).
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/** How many top hybrid candidates we consider for reranking. */
export const RERANK_CANDIDATES = 20;

/** Default number of results returned after reranking. */
export const DEFAULT_LIMIT = 10;

/** Recency decay window in milliseconds (90 days). */
const RECENCY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// ─── Weights / boosts ──────────────────────────────────────────────────────

const HYBRID_WEIGHT = 0.4;
const TITLE_BOOST = 0.15;
const RECENCY_WEIGHT = 0.1;
const LINK_BOOST_PER_INBOUND = 0.05;
const TAG_BOOST = 0.1;

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Optional cross-encoder hook reserved for v2. Receives the query and the
 * current candidate set (post-deterministic-rerank) and returns adjusted
 * scores keyed by `noteId`. v1 callers should leave this undefined.
 */
export type CrossEncoderHook = (
  query: string,
  candidates: ReadonlyArray<HybridSearchResult>,
  signal?: AbortSignal,
) => Promise<Map<string, number>>;

export interface RerankOptions {
  /** Final result count returned. Default: 10. */
  limit?: number;
  /** Abort signal forwarded to a cross-encoder if configured. */
  signal?: AbortSignal;
  /** noteId → tag list (lowercased ideally; we lowercase defensively). */
  tagsByNoteId?: ReadonlyMap<string, ReadonlyArray<string>>;
  /** noteId → ISO timestamp string for last-update. Used for recency decay. */
  updatedAtByNoteId?: ReadonlyMap<string, string>;
  /**
   * noteId → list of noteIds that link _to_ it (inbound links). Caller is
   * expected to fetch this once per query, scoped to the candidate set.
   */
  linkInbound?: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Reserved cross-encoder hook for v2; unused in v1. */
  crossEncoder?: CrossEncoderHook;
  /**
   * Override "now" for deterministic testing of the recency decay.
   * Default: `Date.now()`.
   */
  now?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Tokenize a query into lowercase terms of length ≥ 2. We strip
 * non-alphanumeric characters (keep diacritics) and dedupe.
 */
function tokenize(query: string): string[] {
  const out = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length >= 2) out.add(raw);
  }
  return [...out];
}

/** True when ANY term appears as a substring in `text` (case-insensitive). */
function anyTermInText(terms: ReadonlyArray<string>, text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  for (const t of terms) {
    if (lower.includes(t)) return true;
  }
  return false;
}

/** True when ANY term equals (case-insensitive) any tag in `tags`. */
function anyTermMatchesTag(
  terms: ReadonlyArray<string>,
  tags: ReadonlyArray<string>,
): boolean {
  if (tags.length === 0) return false;
  const lowerTags = new Set(tags.map((t) => t.toLowerCase()));
  for (const t of terms) {
    if (lowerTags.has(t)) return true;
  }
  return false;
}

/**
 * Linear recency in [0, 1]:
 *   - 1.0 if updated within the last hour
 *   - decays linearly to 0.0 at 90 days old
 *   - 0.0 for anything older or for missing/invalid timestamps
 */
function recencyScore(updatedAtIso: string | undefined, now: number): number {
  if (!updatedAtIso) return 0;
  const ts = Date.parse(updatedAtIso);
  if (!Number.isFinite(ts)) return 0;
  const age = now - ts;
  if (age <= 0) return 1;
  if (age >= RECENCY_WINDOW_MS) return 0;
  return 1 - age / RECENCY_WINDOW_MS;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

/**
 * Rerank `candidates` deterministically.
 *
 * Steps:
 *   1. Truncate to top `RERANK_CANDIDATES` (20) by original `combinedScore`.
 *   2. For each candidate, compute a rerank score:
 *        score = hybrid * 0.4
 *              + (titleHit ? 0.15 : 0)
 *              + recency(0..1) * 0.1
 *              + min(inboundCount, 5) * 0.05
 *              + (tagHit ? 0.10 : 0)
 *      `inboundCount` is the number of OTHER candidates in the top set
 *      that link to this note (link-graph boost — encourages clusters of
 *      related, well-connected notes).
 *   3. Stable-sort by score desc.
 *   4. Optionally apply a cross-encoder hook (skipped in v1).
 *   5. Return the top `opts.limit` (default 10).
 */
export async function rerankResults(
  query: string,
  candidates: ReadonlyArray<HybridSearchResult>,
  opts: RerankOptions = {},
): Promise<HybridSearchResult[]> {
  if (candidates.length === 0) return [];

  const limit = opts.limit ?? DEFAULT_LIMIT;
  const now = opts.now ?? Date.now();
  const terms = tokenize(query);

  // 1. Take the top RERANK_CANDIDATES by combined score.
  //    Copy first so we never mutate the caller's array.
  const sortedByHybrid = [...candidates]
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, RERANK_CANDIDATES);

  const topIds = new Set(sortedByHybrid.map((c) => c.noteId));

  // 2. Score each candidate.
  type Scored = {
    candidate: HybridSearchResult;
    score: number;
    /** Position in the truncated-by-hybrid list. Used as a stable tiebreaker. */
    originalIndex: number;
  };

  const scored: Scored[] = sortedByHybrid.map((c, originalIndex) => {
    let score = c.combinedScore * HYBRID_WEIGHT;

    // Title boost — only fires when we actually have query terms.
    if (terms.length > 0 && anyTermInText(terms, c.title)) {
      score += TITLE_BOOST;
    }

    // Recency decay — linear over 90 days.
    const recency = recencyScore(
      opts.updatedAtByNoteId?.get(c.noteId),
      now,
    );
    score += recency * RECENCY_WEIGHT;

    // Link-graph boost — count inbound edges that originate from another
    // top candidate. Cap at 5 to keep boost bounded (≤ 0.25).
    const inbound = opts.linkInbound?.get(c.noteId);
    if (inbound && inbound.length > 0) {
      let count = 0;
      for (const src of inbound) {
        if (src !== c.noteId && topIds.has(src)) count += 1;
      }
      if (count > 5) count = 5;
      score += count * LINK_BOOST_PER_INBOUND;
    }

    // Tag overlap.
    if (terms.length > 0) {
      const tags = opts.tagsByNoteId?.get(c.noteId);
      if (tags && anyTermMatchesTag(terms, tags)) {
        score += TAG_BOOST;
      }
    }

    return { candidate: c, score, originalIndex };
  });

  // 3. Sort by score desc, stable by original hybrid order.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.originalIndex - b.originalIndex;
  });

  // 4. Optional cross-encoder pass (v2). Skipped when undefined.
  if (opts.crossEncoder) {
    const adjusted = await opts.crossEncoder(
      query,
      scored.map((s) => s.candidate),
      opts.signal,
    );
    if (adjusted.size > 0) {
      for (const s of scored) {
        const delta = adjusted.get(s.candidate.noteId);
        if (typeof delta === "number" && Number.isFinite(delta)) {
          s.score += delta;
        }
      }
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.originalIndex - b.originalIndex;
      });
    }
  }

  // 5. Return the top `limit` candidates (preserve original
  //    HybridSearchResult shape — we do NOT overwrite combinedScore so
  //    the UI can still display the original hybrid signal if it wants).
  return scored.slice(0, limit).map((s) => s.candidate);
}
