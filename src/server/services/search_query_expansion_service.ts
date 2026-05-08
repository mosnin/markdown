/**
 * Search query expansion service.
 *
 * Pure, deterministic helper that takes a raw user query and returns:
 *   - `canonical`: a normalized form (lowercased, whitespace collapsed)
 *   - `variants`:  a small list of alternate phrasings to broaden recall
 *
 * Used by hybrid search so multi-word queries with synonyms,
 * abbreviations, or paraphrases also surface notes that talk about the
 * same thing in different words. The keyword (FTS) leg of the search
 * runs against ALL variants OR-joined; the vector leg uses the
 * canonical form (the embedding model handles paraphrase on its own).
 *
 * v1 is intentionally tiny — no LLM call, just:
 *   1. Canonicalization (lowercase + collapse whitespace)
 *   2. Stop-word filtering for variant generation
 *   3. A small, well-curated synonym/abbreviation map
 *   4. Singular ↔ plural for tokens long enough to disambiguate
 *
 * The canonical form is ALWAYS the first entry in `variants` so the
 * user's literal phrasing wins ties.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExpandedQuery {
  /** The user's original phrasing first, then alternates. Capped at 5. */
  variants: string[];
  /** Lowercased + whitespace-normalized form of the input. */
  canonical: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Hard cap on returned variants — keeps FTS OR-clauses bounded. */
const MAX_VARIANTS = 5;

/**
 * Trivial English stop words filtered out when generating per-token
 * variants. Kept short on purpose — FTS already handles most of these,
 * and over-aggressive filtering throws away meaningful terms (e.g. "to"
 * matters in "fail to start"). Stop words stay in the canonical form.
 */
const STOP_WORDS = new Set<string>([
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "for",
  "and",
  "or",
  "is",
  "are",
  "was",
  "were",
  "be",
  "by",
  "with",
  "as",
  "at",
  "it",
]);

/**
 * Curated bidirectional synonym / abbreviation map.
 *
 * Each entry is `term -> [alternates]`. The expansion code applies this
 * map BIDIRECTIONALLY: if either side of a pair appears in the query,
 * the others are emitted as candidates.
 *
 * Keep this list small and high-signal (~30 entries). Generic English
 * synonyms ("big" / "large") belong elsewhere — these are domain
 * shorthands users actually type.
 */
const QUERY_SYNONYMS: Record<string, string[]> = {
  auth: ["authentication"],
  authentication: ["auth"],
  authz: ["authorization"],
  authorization: ["authz"],
  api: ["API"],
  db: ["database"],
  database: ["db"],
  rls: ["row level security"],
  k8s: ["kubernetes"],
  kubernetes: ["k8s"],
  ml: ["machine learning"],
  ai: ["artificial intelligence"],
  llm: ["large language model"],
  ui: ["user interface"],
  ux: ["user experience"],
  ssr: ["server side rendering"],
  csr: ["client side rendering"],
  cdn: ["content delivery network"],
  dns: ["domain name system"],
  url: ["uniform resource locator"],
  jwt: ["json web token"],
  oauth: ["open authorization"],
  sso: ["single sign on"],
  ci: ["continuous integration"],
  cd: ["continuous delivery"],
  cicd: ["ci cd pipeline"],
  pr: ["pull request"],
  qa: ["quality assurance"],
  ops: ["operations"],
  perf: ["performance"],
  config: ["configuration"],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function canonicalize(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Cheap singular ↔ plural toggler. Handles the easy English cases
 * (trailing -s, -es). Skips short tokens to avoid `is` ↔ `i` style
 * mistakes. Returns null when no toggle is appropriate.
 */
function pluralToggle(token: string): string | null {
  if (token.length < 4) return null;
  if (token.endsWith("ies") && token.length > 4) {
    return token.slice(0, -3) + "y";
  }
  if (token.endsWith("es") && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s")) {
    return token.slice(0, -1);
  }
  // Singular → plural: prefer adding -s; -es when ending in s/x/z/ch/sh.
  if (/(s|x|z|ch|sh)$/.test(token)) return token + "es";
  if (token.endsWith("y") && token.length > 2 && !/[aeiou]y$/.test(token)) {
    return token.slice(0, -1) + "ies";
  }
  return token + "s";
}

/**
 * Build candidate variant strings from a canonical query. Each token
 * is independently expanded; we substitute one token at a time rather
 * than producing a combinatorial explosion.
 */
function buildVariants(canonical: string): string[] {
  if (!canonical) return [];

  const tokens = canonical.split(" ").filter(Boolean);
  if (tokens.length === 0) return [];

  const candidates = new Set<string>();

  // Per-token substitution: for each token, emit the canonical query
  // with that token swapped for each of its alternates.
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (STOP_WORDS.has(token)) continue;

    const alternates = new Set<string>();

    // Synonym map (case-insensitive lookup; emit lowercase to match
    // canonical form so dedup works).
    const syn = QUERY_SYNONYMS[token];
    if (syn) {
      for (const s of syn) alternates.add(s.toLowerCase());
    }

    // Singular ↔ plural toggle.
    const toggled = pluralToggle(token);
    if (toggled && toggled !== token) {
      alternates.add(toggled);
    }

    for (const alt of alternates) {
      const next = [...tokens];
      next[i] = alt;
      const variant = next.join(" ").replace(/\s+/g, " ").trim();
      if (variant && variant !== canonical) {
        candidates.add(variant);
      }
    }
  }

  // Also emit a "stop-word-stripped" variant when it differs from
  // canonical — helps FTS match content that omits filler words.
  const stripped = tokens.filter((t) => !STOP_WORDS.has(t)).join(" ");
  if (stripped && stripped !== canonical) {
    candidates.add(stripped);
  }

  return [...candidates];
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Expand a user query into a small set of search variants.
 *
 * The canonical form is always the first entry in `variants` so the
 * user's literal phrasing takes priority during FTS OR-matching.
 *
 * Empty / whitespace-only input returns `{ canonical: "", variants: [""] }`
 * — callers can detect the no-op without a separate null-check.
 */
export function expandQuery(query: string): ExpandedQuery {
  const canonical = canonicalize(query);

  if (!canonical) {
    return { canonical: "", variants: [""] };
  }

  // Canonical first, then expansions, deduped, capped.
  const variants: string[] = [canonical];
  const seen = new Set<string>([canonical]);

  for (const v of buildVariants(canonical)) {
    if (variants.length >= MAX_VARIANTS) break;
    if (seen.has(v)) continue;
    seen.add(v);
    variants.push(v);
  }

  return { canonical, variants };
}
