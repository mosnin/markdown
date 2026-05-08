import { type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { logger } from "@/lib/logger";
import { expandQuery } from "@/server/services/search_query_expansion_service";

/**
 * Embedding service — vector-based semantic search for notes.
 *
 * Integrates with pgvector to provide meaning-based search alongside
 * the existing keyword FTS. When `EMBEDDING_API_KEY` is not set, all
 * embedding operations gracefully no-op so deployments without an
 * embedding provider continue to work unchanged.
 *
 * Key design choices:
 *   - Content hashing deduplicates: re-embedding is skipped when the
 *     note body has not changed.
 *   - `hybridSearch` blends keyword FTS score (0.3) with vector
 *     similarity (0.7) for best-of-both ranking.
 *   - The service never throws on missing API key — it returns null or
 *     empty results, keeping all call sites safe.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SemanticSearchResult {
  noteId: string;
  title: string;
  snippet: string | null;
  similarity: number;
}

/**
 * Per-result provenance signal: which underlying index produced the hit.
 *   - "semantic" — only the vector similarity search matched
 *   - "keyword"  — only the keyword FTS matched
 *   - "both"     — both sources matched (highest confidence)
 *
 * Useful for rendering small "match type" badges in search UI so users
 * can see why a result ranked where it did.
 */
export type HybridMatchType = "semantic" | "keyword" | "both";

export interface HybridSearchResult extends SemanticSearchResult {
  keywordScore: number;
  combinedScore: number;
  matchType: HybridMatchType;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const EMBEDDING_MODEL = "text-embedding-3-small";
const SNIPPET_CHARS = 240;

function clampSnippet(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > SNIPPET_CHARS
    ? trimmed.slice(0, SNIPPET_CHARS - 1) + "\u2026"
    : trimmed;
}

// ─── Embedding generation ───────────────────────────────────────────────────

/**
 * Generate an embedding vector for the given text.
 *
 * Uses the OpenAI-compatible embeddings endpoint. Returns null when
 * `EMBEDDING_API_KEY` is not configured (graceful no-op).
 */
export async function generateEmbedding(
  text: string
): Promise<number[] | null> {
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) return null;

  const baseUrl =
    process.env.EMBEDDING_API_BASE_URL ?? "https://api.openai.com/v1";

  // API failures must NOT throw — callers (including the embed cron)
  // treat a null return as "skip this note and continue the batch".
  // Network errors, JSON parse failures, and non-2xx responses all log
  // and return null so a single bad request can't kill an entire run.
  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.slice(0, 8192), // respect token limit
      }),
    });

    if (!response.ok) {
      console.error(
        "[embedding_service] embedding API error:",
        response.status,
        await response.text().catch((err) => { logger.warn({ err }, "failed to read embedding API error response body"); return ""; })
      );
      return null;
    }

    const json = (await response.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    return json.data?.[0]?.embedding ?? null;
  } catch (err) {
    console.error(
      "[embedding_service] embedding API call failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ─── Upsert ─────────────────────────────────────────────────────────────────

/**
 * Upsert an embedding for a note. Skips re-embedding when content
 * hasn't changed (content_hash dedup). Returns true if an upsert was
 * performed, false if skipped or no-op.
 */
export async function upsertNoteEmbedding(
  supabase: SupabaseClient,
  noteId: string,
  content: string
): Promise<boolean> {
  const hash = contentHash(content);

  // Check for existing row with same hash → skip.
  const { data: existing } = await supabase
    .from("note_embeddings")
    .select("id, content_hash")
    .eq("note_id", noteId)
    .maybeSingle();

  if (existing?.content_hash === hash) {
    return false; // content unchanged
  }

  const embedding = await generateEmbedding(content);
  if (!embedding) return false;

  const row = {
    note_id: noteId,
    embedding: JSON.stringify(embedding),
    model: EMBEDDING_MODEL,
    content_hash: hash,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    // Update existing row.
    const { error } = await supabase
      .from("note_embeddings")
      .update(row)
      .eq("id", existing.id);
    if (error) {
      throw new Error(`Failed to upsert embedding: ${error.message}`);
    }
  } else {
    // Insert new row.
    const { error } = await supabase.from("note_embeddings").insert(row);
    if (error) {
      throw new Error(`Failed to upsert embedding: ${error.message}`);
    }
  }

  return true;
}

// ─── Semantic search ────────────────────────────────────────────────────────

/**
 * Search notes by vector similarity within a workspace.
 *
 * Embeds the query, then finds the closest note embeddings using cosine
 * similarity. Returns an empty array when embeddings are not configured.
 */
export async function semanticSearch(
  supabase: SupabaseClient,
  workspaceId: string,
  query: string,
  opts: { limit?: number; branchId?: string | null } = {}
): Promise<SemanticSearchResult[]> {
  const limit = opts.limit ?? 20;
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) return [];

  // Use raw SQL via rpc since PostgREST cannot express vector operators
  // directly. We fall back to a simulated approach with a raw query.
  //
  // The query joins note_embeddings to notes for workspace scoping and
  // computes cosine similarity as 1 - (embedding <=> query_embedding).
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const { data, error } = await supabase.rpc("match_note_embeddings", {
    query_embedding: embeddingStr,
    match_workspace_id: workspaceId,
    match_limit: limit,
    match_branch_id: opts.branchId ?? null,
  });

  if (error) {
    // If the RPC doesn't exist yet (migration not run), fall back to
    // a simpler query. In production the RPC should exist.
    console.error("[embedding_service] match_note_embeddings RPC error:", error);

    // Fallback: direct query without vector ops (returns empty).
    return [];
  }

  return ((data as Array<{
    note_id: string;
    title: string;
    summary: string | null;
    markdown_content: string | null;
    similarity: number;
  }>) ?? []).map((r) => ({
    noteId: r.note_id,
    title: r.title,
    snippet: clampSnippet(r.summary ?? r.markdown_content),
    similarity: r.similarity,
  }));
}

// ─── Hybrid search ──────────────────────────────────────────────────────────

/**
 * Combine keyword FTS and vector similarity for best-of-both ranking.
 *
 * Weight: keyword_score * 0.3 + similarity * 0.7.
 *
 * Falls back to keyword-only when embeddings are unavailable.
 */
export async function hybridSearch(
  supabase: SupabaseClient,
  workspaceId: string,
  query: string,
  opts: { limit?: number; branchId?: string | null } = {}
): Promise<HybridSearchResult[]> {
  const limit = opts.limit ?? 20;

  // Query expansion (B2): canonical form drives the vector leg (the
  // embedding model already handles paraphrase), while ALL variants
  // OR-join the FTS leg so synonyms / abbreviations / plurals widen
  // keyword recall. The canonical form is always variants[0], so the
  // user's literal phrasing keeps priority in keyword scoring.
  const { canonical, variants } = expandQuery(query);

  // Run both searches in parallel.
  const [semanticResults, keywordResults] = await Promise.all([
    semanticSearch(supabase, workspaceId, canonical, { limit, branchId: opts.branchId }),
    fetchKeywordResults(supabase, workspaceId, variants, limit),
  ]);

  // Build a map of note_id → best scores from each source, tracking
  // which source(s) contributed the hit so the UI can render match-type
  // badges ("semantic", "keyword", or "both").
  const merged = new Map<
    string,
    {
      noteId: string;
      title: string;
      snippet: string | null;
      similarity: number;
      keywordScore: number;
      fromSemantic: boolean;
      fromKeyword: boolean;
    }
  >();

  // Normalize keyword scores to 0-1 range.
  const maxKeyword = keywordResults.reduce(
    (m, r) => Math.max(m, r.rank),
    1 // avoid division by zero
  );

  for (const r of semanticResults) {
    merged.set(r.noteId, {
      noteId: r.noteId,
      title: r.title,
      snippet: r.snippet,
      similarity: r.similarity,
      keywordScore: 0,
      fromSemantic: true,
      fromKeyword: false,
    });
  }

  for (const r of keywordResults) {
    const existing = merged.get(r.id);
    const normalizedScore = r.rank / maxKeyword;
    if (existing) {
      existing.keywordScore = normalizedScore;
      existing.fromKeyword = true;
      // Prefer keyword title/snippet if semantic didn't have good ones.
      if (!existing.snippet && r.snippet) {
        existing.snippet = r.snippet;
      }
    } else {
      merged.set(r.id, {
        noteId: r.id,
        title: r.title,
        snippet: r.snippet,
        similarity: 0,
        keywordScore: normalizedScore,
        fromSemantic: false,
        fromKeyword: true,
      });
    }
  }

  // Rank by combined score.
  const results: HybridSearchResult[] = [...merged.values()].map((r) => ({
    noteId: r.noteId,
    title: r.title,
    snippet: r.snippet,
    similarity: r.similarity,
    keywordScore: r.keywordScore,
    combinedScore: r.keywordScore * 0.3 + r.similarity * 0.7,
    matchType:
      r.fromSemantic && r.fromKeyword
        ? "both"
        : r.fromSemantic
          ? "semantic"
          : "keyword",
  }));

  results.sort((a, b) => b.combinedScore - a.combinedScore);

  return results.slice(0, limit);
}

// ─── Internal keyword search helper ─────────────────────────────────────────

interface KeywordHit {
  id: string;
  title: string;
  snippet: string | null;
  rank: number;
}

/**
 * Fetch keyword search results scoped to a workspace. Uses the
 * workspace_search_service's cross-type search but filters to notes
 * only, then normalizes to a lightweight shape for hybrid ranking.
 *
 * Accepts an array of query variants (from `expandQuery`) and OR-joins
 * them across `title.ilike` / `markdown_content.ilike` so synonyms
 * and pluralizations broaden recall. variants[0] is the canonical
 * form and is what scoring keys off (a hit on the canonical phrasing
 * outranks a hit on a synonym variant).
 */
async function fetchKeywordResults(
  supabase: SupabaseClient,
  workspaceId: string,
  variants: string[],
  limit: number
): Promise<KeywordHit[]> {
  // Trim + drop blanks; bail if nothing usable remains.
  const trimmed = variants.map((v) => v.trim()).filter((v) => v.length > 0);
  if (trimmed.length === 0) return [];

  const canonical = trimmed[0];

  // `notes` has no `workspace_id` column; workspace membership is
  // inherited via `notes.box_id → boxes.workspace_id`. Fetch the box
  // ids for the workspace first, then filter notes by `box_id IN (...)`.
  const { data: boxes } = await supabase
    .from("boxes")
    .select("id")
    .eq("workspace_id", workspaceId);

  const boxIds = (boxes ?? []).map((b: { id: string }) => b.id);
  if (boxIds.length === 0) return [];

  // Build a single PostgREST `or(...)` clause that matches any variant
  // against either column. Escape `%` and `_` so user input can't act
  // as wildcards; commas are stripped because PostgREST uses them as
  // the or-clause separator.
  const orClauses: string[] = [];
  for (const v of trimmed) {
    const safe = v.replace(/[%_]/g, "\\$&").replace(/,/g, " ");
    const like = `%${safe}%`;
    orClauses.push(`title.ilike.${like}`);
    orClauses.push(`markdown_content.ilike.${like}`);
  }

  const { data } = await supabase
    .from("notes")
    .select("id, title, summary, markdown_content, status, updated_at")
    .in("box_id", boxIds)
    .neq("status", "trashed")
    .is("branch_id", null)
    .or(orClauses.join(","))
    .limit(limit);

  const canonicalLower = canonical.toLowerCase();

  return (data ?? []).map((n: {
    id: string;
    title: string;
    summary: string | null;
    markdown_content: string | null;
  }) => ({
    id: n.id,
    title: n.title,
    snippet: clampSnippet(n.summary ?? n.markdown_content),
    // Score: canonical title hit > any title hit > body-only hit. This
    // keeps the user's literal phrasing ranked above synonym-only hits.
    rank: n.title.toLowerCase().includes(canonicalLower)
      ? 10
      : trimmed.some((v) => n.title.toLowerCase().includes(v.toLowerCase()))
        ? 5
        : 1,
  }));
}
