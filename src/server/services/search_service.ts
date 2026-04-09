import { type SupabaseClient } from "@supabase/supabase-js";
import { type Note } from "@/server/domain/types/note";

/**
 * Search service — V1 deterministic keyword search.
 *
 * Uses the search_notes Postgres RPC function which queries the stored
 * search_vector tsvector column (GIN-indexed) with weighted field ranking.
 *
 * Ranking is deterministic:
 *   1. Exact title match (boost +4.0)
 *   2. Title prefix match (boost +2.0)
 *   3. ts_rank_cd weighted FTS score × 10 (title+tags=A, summary=B, body=C)
 *   4. retrieval_priority nudge (0–1)
 *   5. updated_at desc (tie-break, handled in SQL)
 *
 * Searching is always scoped to a single box — cross-box search is out of
 * scope for V1.
 */

export interface NoteSearchResult extends Note {
  rank: number;
}

/**
 * Search notes within a box using Postgres FTS.
 * Returns at most `limit` results, ranked by deterministic score.
 * Returns [] for blank queries.
 */
export async function searchNotes(
  supabase: SupabaseClient,
  boxId: string,
  query: string,
  limit = 20
): Promise<NoteSearchResult[]> {
  if (!query.trim()) return [];

  const { data, error } = await supabase.rpc("search_notes", {
    p_box_id: boxId,
    p_query: query.trim(),
    p_limit: limit,
  });

  if (error) {
    console.error("[search_service] search_notes RPC error:", error);
    return [];
  }

  return (data ?? []) as NoteSearchResult[];
}
