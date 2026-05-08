/**
 * Search snippet service — context-aware snippet generation v2.
 *
 * Today, search results display the static `summary` field stored on the
 * note. That gives no signal about *why* a result matched: the matched
 * terms might never appear in the summary at all. This service generates
 * better snippets by locating each query-term occurrence inside the full
 * content, taking a window of surrounding characters, merging
 * overlapping windows, and returning text plus explicit highlight ranges
 * so the UI can render `<mark>` (or any visual treatment) without
 * round-tripping HTML through the API.
 *
 * Strategy:
 *   1. For every query variant, find every case-insensitive,
 *      word-boundary occurrence in the content.
 *   2. For each match, take a ±`windowChars` window (default 100).
 *   3. Merge overlapping windows so we don't show duplicate context.
 *   4. Cap at `maxSnippets` (default 3) to keep the result list scannable.
 *   5. Return text plus 0-indexed `highlights` ranges relative to the
 *      snippet text — the UI is responsible for rendering `<mark>`.
 *
 * No matches → return a single snippet of the first 200 chars so the
 * caller still has *something* to show.
 */

export interface SearchSnippet {
  /** The snippet text itself (already trimmed and ellipsis-prefixed/suffixed). */
  text: string;
  /** Highlight ranges within `text`. Half-open: [start, end). */
  highlights: Array<{ start: number; end: number }>;
}

interface GenerateSnippetsOptions {
  /** Maximum number of snippets to return. Default 3. */
  maxSnippets?: number;
  /** Characters of context on each side of a match. Default 100. */
  windowChars?: number;
}

interface RawMatch {
  /** Inclusive start offset of the matched term in the full content. */
  start: number;
  /** Exclusive end offset of the matched term in the full content. */
  end: number;
}

interface RawWindow {
  /** Inclusive window start in content. */
  start: number;
  /** Exclusive window end in content. */
  end: number;
  /** Match ranges that fell into this window, in content coordinates. */
  matches: RawMatch[];
}

const DEFAULT_MAX_SNIPPETS = 3;
const DEFAULT_WINDOW_CHARS = 100;
const FALLBACK_PREFIX_CHARS = 200;
const ELLIPSIS = "…";

/**
 * Escape a string for safe inclusion in a `RegExp`.
 *
 * We can't use `RegExp` flag `d` or named groups here because the
 * service must run on Node 18+; sticking to `[\\.*+?^${}()|[\]\\]`
 * keeps things portable.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a single combined word-boundary regex from a list of variants.
 * Returns null when there are no usable variants.
 *
 * `\b` honours word boundaries against `[A-Za-z0-9_]`. For most search
 * terms this prevents matching `react` inside `reactor` while still
 * matching `react` followed by punctuation.
 */
function buildVariantRegex(variants: string[]): RegExp | null {
  const usable = variants
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map(escapeRegExp);
  if (usable.length === 0) return null;

  // Sort longest-first so the alternation prefers `react native` over
  // just `react` when both are variants — leftmost-longest is what
  // users intuit.
  usable.sort((a, b) => b.length - a.length);

  return new RegExp(`\\b(?:${usable.join("|")})\\b`, "gi");
}

/**
 * Find every match across the content. Word boundaries respected,
 * case-insensitive.
 */
function findAllMatches(content: string, regex: RegExp): RawMatch[] {
  const matches: RawMatch[] = [];
  // Reset state on the shared regex; required because of the `g` flag.
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    // Defensive: zero-length matches would loop forever.
    if (m[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    matches.push({ start: m.index, end: m.index + m[0].length });
  }
  return matches;
}

/**
 * Build raw windows around each match and merge overlaps.
 *
 * Two windows merge when they touch or overlap (i.e. `nextStart <=
 * currentEnd`). Each merged window keeps every match it contains so the
 * highlight ranges are preserved.
 */
function buildMergedWindows(
  matches: RawMatch[],
  contentLength: number,
  windowChars: number
): RawWindow[] {
  if (matches.length === 0) return [];

  // Build initial windows clamped to [0, contentLength].
  const initial: RawWindow[] = matches.map((match) => ({
    start: Math.max(0, match.start - windowChars),
    end: Math.min(contentLength, match.end + windowChars),
    matches: [match],
  }));

  // Sort by start so we can do a single linear merge.
  initial.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: RawWindow[] = [];
  for (const win of initial) {
    const last = merged[merged.length - 1];
    if (last && win.start <= last.end) {
      last.end = Math.max(last.end, win.end);
      last.matches.push(...win.matches);
    } else {
      merged.push({ ...win, matches: [...win.matches] });
    }
  }

  return merged;
}

/**
 * Trim a window to the nearest whitespace on either side so we don't
 * cleave words in half. Falls back to the original boundary when no
 * whitespace is found within a small lookahead.
 *
 * We bound the search to 20 chars to avoid runaway scanning on
 * pathological inputs (e.g. minified content with no whitespace).
 */
function snapToWordBoundary(
  content: string,
  start: number,
  end: number
): { start: number; end: number } {
  const SNAP_BUDGET = 20;

  let snappedStart = start;
  if (start > 0) {
    const limit = Math.max(0, start - SNAP_BUDGET);
    for (let i = start; i > limit; i--) {
      if (/\s/.test(content[i - 1] ?? "")) {
        snappedStart = i;
        break;
      }
    }
  }

  let snappedEnd = end;
  if (end < content.length) {
    const limit = Math.min(content.length, end + SNAP_BUDGET);
    for (let i = end; i < limit; i++) {
      if (/\s/.test(content[i] ?? "")) {
        snappedEnd = i;
        break;
      }
    }
  }

  return { start: snappedStart, end: snappedEnd };
}

/**
 * Convert a merged content-coordinate window into a `SearchSnippet`
 * with snippet-relative highlight ranges, ellipsis affixes, and
 * collapsed whitespace.
 *
 * Collapsing whitespace after slicing requires us to re-map highlight
 * offsets, which is fiddly — so we leave whitespace as-is *inside* the
 * window and only normalise the surrounding ellipsis affixes. UI line
 * clamping handles the rest.
 */
function buildSnippet(content: string, win: RawWindow): SearchSnippet {
  const { start, end } = snapToWordBoundary(content, win.start, win.end);
  const sliced = content.slice(start, end);

  const prefix = start > 0 ? `${ELLIPSIS} ` : "";
  const suffix = end < content.length ? ` ${ELLIPSIS}` : "";
  const text = `${prefix}${sliced}${suffix}`;
  const offset = prefix.length;

  const highlights = win.matches
    .map((match) => {
      // Translate content-absolute offsets into snippet-relative ones.
      const hStart = match.start - start + offset;
      const hEnd = match.end - start + offset;
      return { start: hStart, end: hEnd };
    })
    // Drop highlights that fell outside the snapped window — possible
    // when `snapToWordBoundary` shrank the boundary onto whitespace
    // exactly at a match edge (rare but defensible).
    .filter((h) => h.start >= 0 && h.end <= text.length && h.start < h.end)
    // De-duplicate identical ranges (when multiple variants matched the
    // same span, e.g. variants ["react", "React"]).
    .filter((h, i, arr) => {
      return arr.findIndex((o) => o.start === h.start && o.end === h.end) === i;
    })
    .sort((a, b) => a.start - b.start);

  return { text, highlights };
}

/**
 * Score a window for ranking when more candidates exist than
 * `maxSnippets`. More matches first, then earlier in the document as a
 * tie-breaker (early hits tend to be in headings/intros).
 */
function rankWindows(windows: RawWindow[]): RawWindow[] {
  return [...windows].sort((a, b) => {
    if (b.matches.length !== a.matches.length) {
      return b.matches.length - a.matches.length;
    }
    return a.start - b.start;
  });
}

/**
 * Generate context-aware snippets for the given content and query
 * variants. See file-level docstring for the full strategy.
 *
 * Behaviour highlights:
 *   * Empty content → returns `[]`.
 *   * No usable variants → returns a single snippet of the first 200
 *     chars (or all of it, if shorter), with no highlights.
 *   * No matches → same fallback as no usable variants.
 *   * Otherwise: up to `maxSnippets` snippets, ranked by match density.
 */
export function generateSnippets(
  content: string,
  queryVariants: string[],
  opts: GenerateSnippetsOptions = {}
): SearchSnippet[] {
  if (!content) return [];

  const maxSnippets = Math.max(1, opts.maxSnippets ?? DEFAULT_MAX_SNIPPETS);
  const windowChars = Math.max(0, opts.windowChars ?? DEFAULT_WINDOW_CHARS);

  const regex = buildVariantRegex(queryVariants);
  const matches = regex ? findAllMatches(content, regex) : [];

  if (matches.length === 0) {
    return [buildFallbackSnippet(content)];
  }

  const merged = buildMergedWindows(matches, content.length, windowChars);
  // Rank by match density so we keep the most informative snippets when
  // we have to drop some, but preserve document order for the *output*
  // so the UI reads top-to-bottom.
  const ranked = rankWindows(merged).slice(0, maxSnippets);
  ranked.sort((a, b) => a.start - b.start);

  return ranked.map((win) => buildSnippet(content, win));
}

/**
 * Used when no query variants matched the content. Returns the first
 * `FALLBACK_PREFIX_CHARS` characters as a single snippet with no
 * highlights, suffixed with an ellipsis when the content was longer.
 */
function buildFallbackSnippet(content: string): SearchSnippet {
  const truncated = content.length > FALLBACK_PREFIX_CHARS;
  const slice = content.slice(0, FALLBACK_PREFIX_CHARS);
  const text = truncated ? `${slice} ${ELLIPSIS}` : slice;
  return { text, highlights: [] };
}
