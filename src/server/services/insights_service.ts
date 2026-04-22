/**
 * Atomic insights extraction.
 *
 * Mirrors knowledge_graph_service but extracts propositional claims
 * rather than named entities. Runs on the same save trigger (but is
 * NOT automatically wired in this PR — integration is a separate task).
 *
 * Uses gpt-4o-mini with a strict JSON schema constraint. Returns at
 * most 10 insights per note to cap cost.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInsight, deleteInsightsForNote } from "@/server/repositories/insight_repository";
import type { InsightCategory } from "@/server/domain/types/insight";

const MODEL = "gpt-4o-mini";

interface ExtractedInsight {
  claim: string;
  category: InsightCategory;
  confidence: number;
  source_excerpt: string;
}

const SYSTEM_PROMPT = `You extract atomic claims from a markdown note.

An atomic claim is a single, self-contained, verifiable statement. It stands alone without needing the rest of the note for context.

CATEGORIES:
- fact: objective observation ("pgvector is Postgres-native")
- decision: an explicit choice ("We chose Postgres over Mongo")
- insight: synthesized understanding ("The bottleneck is I/O not CPU")
- question: open investigation ("Does HNSW scale to 1M vectors?")
- action: intended work ("Migrate auth to WebAuthn by Q4")

RULES:
- Extract 0–10 insights. Fewer is fine — only extract genuinely atomic claims.
- Skip trivial prose ("Today was good"), aspirations ("We should be better"), or content that is not a claim.
- "claim" should be a single clear sentence, rewritten as a standalone statement if needed.
- "source_excerpt" is the verbatim text from the note that generated the claim.
- "confidence" 0-1: how clear was the claim in the source text (1.0 = explicit, 0.5 = inferred).

Return strict JSON matching the schema.`;

const JSON_SCHEMA = {
  type: "object",
  properties: {
    insights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          category: { type: "string", enum: ["fact","decision","insight","question","action"] },
          confidence: { type: "number" },
          source_excerpt: { type: "string" },
        },
        required: ["claim","category","confidence","source_excerpt"],
        additionalProperties: false,
      },
    },
  },
  required: ["insights"],
  additionalProperties: false,
} as const;

async function callModel(title: string, content: string): Promise<ExtractedInsight[] | null> {
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) return null;
  const baseUrl = process.env.EMBEDDING_API_BASE_URL ?? "https://api.openai.com/v1";

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Note: ${title}\n\n${content.slice(0, 8000)}` },
        ],
        response_format: { type: "json_schema", json_schema: { name: "insights_extraction", strict: true, schema: JSON_SCHEMA } },
        temperature: 0.0,
      }),
    });
    if (!resp.ok) {
      console.error("[insights_service] extraction failed:", resp.status);
      return null;
    }
    const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as { insights: ExtractedInsight[] };
    return parsed.insights ?? [];
  } catch (err) {
    console.error("[insights_service] extraction error:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function extractAndStoreInsights(
  supabase: SupabaseClient,
  params: { workspaceId: string; noteId: string; title: string; content: string }
): Promise<{ insightsCreated: number } | null> {
  // Privacy gate — use the same workspace flag as the knowledge graph
  const { data: ws } = await supabase
    .from("workspaces")
    .select("knowledge_graph_enabled")
    .eq("id", params.workspaceId)
    .maybeSingle();
  if (ws && ws.knowledge_graph_enabled === false) return null;

  const insights = await callModel(params.title, params.content);
  if (!insights) return null;

  await deleteInsightsForNote(supabase, params.noteId);

  let created = 0;
  for (const ins of insights) {
    try {
      await createInsight(supabase, {
        workspace_id: params.workspaceId,
        note_id: params.noteId,
        claim: ins.claim,
        category: ins.category,
        confidence: Math.max(0, Math.min(1, ins.confidence)),
        source_excerpt: ins.source_excerpt,
      });
      created += 1;
    } catch (err) {
      console.error("[insights_service] insight write failed:", err instanceof Error ? err.message : err);
    }
  }
  return { insightsCreated: created };
}
