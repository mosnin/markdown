/**
 * Pog context assembly service.
 *
 * Before dispatching a conversation turn to the workspace operator
 * (Modal agent harness), this service builds a block of workspace
 * context that is prepended to the agent system prompt. Two components:
 *
 *   1. Workspace vocabulary — the top 20 most-mentioned entities, so
 *      the agent uses the user's actual terminology (e.g. "Alice"
 *      instead of "someone named Alice").
 *
 *   2. GraphRAG context — for the specific user query, the entities
 *      matched plus the notes they connect to, with a rationale per
 *      note so the agent can cite its sources.
 *
 * Both are best-effort and fail open: if the graph is empty or the
 * query has no entity matches, we return an empty string and the
 * agent runs with its normal context bundle only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  graphRagQuery,
  formatGraphRagContext,
} from "@/server/services/graph_rag_service";
import { listEntitiesByWorkspace } from "@/server/repositories/entity_repository";

const VOCABULARY_LIMIT = 20;
const GRAPH_RAG_MAX_HITS = 8;

export async function buildPogGraphContext(
  supabase: SupabaseClient,
  workspaceId: string,
  userQuery: string
): Promise<string> {
  const [vocab, graphResult] = await Promise.all([
    listEntitiesByWorkspace(supabase, workspaceId, { limit: VOCABULARY_LIMIT }),
    graphRagQuery(supabase, workspaceId, userQuery, {
      maxHops: 1,
      maxHits: GRAPH_RAG_MAX_HITS,
    }),
  ]);

  const sections: string[] = [];

  if (vocab.length > 0) {
    const vocabLines = vocab
      .map(
        (e) =>
          `- ${e.name} (${e.entity_type})${e.description ? ` — ${e.description}` : ""}`
      )
      .join("\n");
    sections.push(`## Workspace Vocabulary\n${vocabLines}`);
  }

  const rag = formatGraphRagContext(graphResult);
  if (rag) sections.push(rag);

  return sections.join("\n\n");
}
