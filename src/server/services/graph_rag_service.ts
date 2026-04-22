/**
 * GraphRAG retrieval service.
 *
 * Standard semantic search returns notes that are "similar in meaning" to
 * the query. GraphRAG augments that with entity-centric retrieval:
 *
 *   1. Extract candidate entities from the query (keyword match against
 *      known workspace entities; could upgrade to LLM extraction later).
 *   2. Expand: for each matched entity, traverse one edge hop.
 *   3. Collect all mentions → dedupe by note → score by entity centrality
 *      (mention_count) and edge confidence.
 *
 * The result is a ranked list of note IDs with a rationale per note
 * ("cited because it mentions Alice who owns Q4 Launch"). Callers mix
 * these IDs with vector search hits to build agent context.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entity } from "@/server/domain/types/entity";
import type { EntityEdge } from "@/server/domain/types/entity_edge";
import {
  listEntitiesByWorkspace,
  getEntityById,
} from "@/server/repositories/entity_repository";
import { listMentionsByEntity } from "@/server/repositories/entity_mention_repository";
import { listEdgesForEntity } from "@/server/repositories/entity_edge_repository";

export interface GraphRagHit {
  noteId: string;
  score: number;
  viaEntityId: string;
  viaEntityName: string;
  rationale: string;
}

export interface GraphRagResult {
  matchedEntities: Entity[];
  expandedEntityIds: string[];
  hits: GraphRagHit[];
}

/**
 * Match query tokens against known entity names in the workspace.
 *
 * Simple approach: lowercase-normalize both, require a full word match
 * (word-boundary regex) so "Q4" doesn't match every 4-digit. Returns up
 * to N most-mentioned matches first.
 */
function matchQueryEntities(query: string, allEntities: Entity[]): Entity[] {
  const q = query.toLowerCase();
  const matches: Array<{ entity: Entity; score: number }> = [];
  for (const e of allEntities) {
    const nameLower = e.name.toLowerCase();
    // Exact token match — word boundaries on either side
    const pattern = new RegExp(`(^|\\W)${escapeRegex(nameLower)}(\\W|$)`, "i");
    if (pattern.test(q)) {
      // Score = mention_count + small bump for longer (more specific) names
      matches.push({ entity: e, score: e.mention_count + e.name.length * 0.1 });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 8).map((m) => m.entity);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Run GraphRAG for a query in a workspace.
 *
 * opts.maxHops: defaults to 1 (direct neighbors). Hop 0 = only the
 * matched entities themselves, no expansion.
 */
export async function graphRagQuery(
  supabase: SupabaseClient,
  workspaceId: string,
  query: string,
  opts: { maxHops?: number; maxHits?: number } = {}
): Promise<GraphRagResult> {
  const maxHops = opts.maxHops ?? 1;
  const maxHits = opts.maxHits ?? 12;

  // Step 1: load all entities for the workspace (bounded by mention_count;
  // for very large graphs we'd want name-based FTS instead).
  const allEntities = await listEntitiesByWorkspace(supabase, workspaceId, { limit: 500 });
  if (allEntities.length === 0) {
    return { matchedEntities: [], expandedEntityIds: [], hits: [] };
  }

  // Step 2: match query → candidate entities
  const matchedEntities = matchQueryEntities(query, allEntities);
  if (matchedEntities.length === 0) {
    return { matchedEntities: [], expandedEntityIds: [], hits: [] };
  }

  // Step 3: expand one hop via edges
  const expanded = new Set<string>(matchedEntities.map((e) => e.id));
  const edgeMap = new Map<string, EntityEdge[]>(); // keyed by entity id it touches

  if (maxHops >= 1) {
    for (const e of matchedEntities) {
      const edges = await listEdgesForEntity(supabase, e.id);
      edgeMap.set(e.id, edges);
      for (const edge of edges) {
        if (edge.source_entity_id === e.id) expanded.add(edge.target_entity_id);
        else expanded.add(edge.source_entity_id);
      }
    }
  }

  // Step 4: collect mentions → dedupe by note → score
  const noteScores = new Map<string, GraphRagHit>();
  for (const entityId of expanded) {
    const entity = matchedEntities.find((m) => m.id === entityId) ?? await getEntityById(supabase, entityId);
    if (!entity) continue;
    const isDirectMatch = matchedEntities.some((m) => m.id === entityId);
    const baseScore = isDirectMatch ? 2.0 : 1.0;

    const mentions = await listMentionsByEntity(supabase, entityId, { limit: 50 });
    for (const mention of mentions) {
      const existing = noteScores.get(mention.note_id);
      // Score accumulates when multiple matched entities share a note.
      const incrementalScore = baseScore + Math.log1p(entity.mention_count) * 0.1;
      if (existing) {
        existing.score += incrementalScore;
        existing.rationale += `; ${isDirectMatch ? "mentions" : "links to"} ${entity.name}`;
      } else {
        noteScores.set(mention.note_id, {
          noteId: mention.note_id,
          score: incrementalScore,
          viaEntityId: entityId,
          viaEntityName: entity.name,
          rationale: `${isDirectMatch ? "Mentions" : "Links to"} ${entity.name}`,
        });
      }
    }
  }

  const hits = [...noteScores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxHits);

  return {
    matchedEntities,
    expandedEntityIds: [...expanded],
    hits,
  };
}

/**
 * Build a compact text context block from GraphRAG hits for inclusion in
 * an agent system prompt. Each hit appears as a single line with the
 * rationale, ready to be joined with semantic search hits.
 */
export function formatGraphRagContext(result: GraphRagResult): string {
  if (result.hits.length === 0) return "";
  const lines = [
    "## Knowledge Graph Context",
    `Matched entities: ${result.matchedEntities.map((e) => `${e.name} (${e.entity_type})`).join(", ")}`,
    "",
    "Relevant notes:",
    ...result.hits.map(
      (h, i) => `  ${i + 1}. note:${h.noteId} — ${h.rationale} (score: ${h.score.toFixed(2)})`
    ),
  ];
  return lines.join("\n");
}
