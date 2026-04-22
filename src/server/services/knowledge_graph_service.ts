/**
 * Knowledge graph extraction service.
 *
 * On note save, extracts named entities (people, projects, concepts, events,
 * decisions, organizations) and inter-entity relationships from the markdown
 * content using OpenAI's JSON-schema-constrained completions. The extracted
 * graph powers GraphRAG retrieval — the ability to answer questions about
 * relationships between ideas rather than just keyword or semantic similarity.
 *
 * Runs fire-and-forget via next/server `after()` after a note save commits.
 * Failures are logged and skipped — extraction is opportunistic, not critical.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createEntity,
  findEntityByName,
  incrementMentionCount,
} from "@/server/repositories/entity_repository";
import {
  createMention,
  deleteMentionsForNote,
} from "@/server/repositories/entity_mention_repository";
import {
  createEdge,
  deleteEdgesForNote,
} from "@/server/repositories/entity_edge_repository";
import type { EntityType } from "@/server/domain/types/entity";
import type { EntityEdgeType } from "@/server/domain/types/entity_edge";

const EXTRACTION_MODEL = "gpt-4o-mini";

interface ExtractedEntity {
  name: string;
  type: EntityType;
  description: string;
  surface_form: string;
  context: string;
}

interface ExtractedEdge {
  source_name: string;
  source_type: EntityType;
  target_name: string;
  target_type: EntityType;
  edge_type: EntityEdgeType;
  context: string;
  confidence: number;
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  edges: ExtractedEdge[];
}

const SYSTEM_PROMPT = `You extract named entities and their relationships from markdown notes.

ENTITIES to extract:
- person: individual people by name (e.g. "Alice", "Dr. Chen")
- project: named initiatives, products, codenames (e.g. "Q4 Launch", "Project Poseidon")
- concept: recurring ideas, frameworks, methodologies (e.g. "GraphRAG", "unit economics")
- organization: companies, teams, departments (e.g. "Stripe", "Platform team")
- event: meetings, conferences, deadlines (e.g. "All-hands 2025-Q4")
- decision: explicit decisions made (e.g. "Use Postgres over Mongo")

RULES:
- Skip trivial entities (common nouns, dates alone, generic terms)
- Each entity appears ONCE per extraction with its canonical name
- description: one sentence explaining what this entity is, in the note's context
- surface_form: the exact string from the note that referred to this entity
- Extract up to 15 entities and 10 edges per note

EDGES capture relationships: mentions, causes, decides, owns, relates_to, contradicts, supports, depends_on.

Return a strict JSON object matching the schema.`;

const JSON_SCHEMA = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: {
            type: "string",
            enum: [
              "person",
              "project",
              "concept",
              "organization",
              "event",
              "decision",
              "other",
            ],
          },
          description: { type: "string" },
          surface_form: { type: "string" },
          context: { type: "string" },
        },
        required: ["name", "type", "description", "surface_form", "context"],
        additionalProperties: false,
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source_name: { type: "string" },
          source_type: {
            type: "string",
            enum: [
              "person",
              "project",
              "concept",
              "organization",
              "event",
              "decision",
              "other",
            ],
          },
          target_name: { type: "string" },
          target_type: {
            type: "string",
            enum: [
              "person",
              "project",
              "concept",
              "organization",
              "event",
              "decision",
              "other",
            ],
          },
          edge_type: {
            type: "string",
            enum: [
              "mentions",
              "causes",
              "decides",
              "owns",
              "relates_to",
              "contradicts",
              "supports",
              "depends_on",
            ],
          },
          context: { type: "string" },
          confidence: { type: "number" },
        },
        required: [
          "source_name",
          "source_type",
          "target_name",
          "target_type",
          "edge_type",
          "context",
          "confidence",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["entities", "edges"],
  additionalProperties: false,
} as const;

async function callExtractionModel(
  noteTitle: string,
  noteContent: string
): Promise<ExtractionResult | null> {
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) return null;

  const baseUrl =
    process.env.EMBEDDING_API_BASE_URL ?? "https://api.openai.com/v1";
  const body = {
    model: EXTRACTION_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Note title: ${noteTitle}\n\n${noteContent.slice(0, 8000)}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "kg_extraction",
        strict: true,
        schema: JSON_SCHEMA,
      },
    },
    temperature: 0.0,
  };

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.error(
        "[knowledge_graph_service] extraction failed:",
        resp.status,
        await resp.text().catch(() => "")
      );
      return null;
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content) as ExtractionResult;
  } catch (err) {
    console.error(
      "[knowledge_graph_service] extraction error:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Debounce window — skip re-extraction when this note was processed
 * within the last 30 seconds. Stops rapid autosaves from racking up
 * LLM cost during a flurry of edits.
 */
const EXTRACTION_DEBOUNCE_MS = 30_000;

/**
 * Extract entities/edges from a note and upsert them into the graph.
 *
 * - Re-runs delete existing mentions and edges for the note first, so the
 *   graph always reflects current content (no stale mentions after edits).
 * - Entity rows persist across re-extractions (just have their mention_count
 *   bumped). This avoids losing entity history when a user edits a note.
 * - Honors the workspace `knowledge_graph_enabled` flag (privacy opt-out)
 *   and the 30-second per-note debounce window (cost control).
 */
export async function extractAndStoreEntities(
  supabase: SupabaseClient,
  params: {
    workspaceId: string;
    noteId: string;
    title: string;
    content: string;
    branchId?: string | null;
  }
): Promise<{
  entitiesCreated: number;
  mentionsCreated: number;
  edgesCreated: number;
} | null> {
  // Privacy gate: workspace-level opt-out
  const { data: ws } = await supabase
    .from("workspaces")
    .select("knowledge_graph_enabled")
    .eq("id", params.workspaceId)
    .maybeSingle();
  if (ws && ws.knowledge_graph_enabled === false) return null;

  // Cost gate: debounce per-note extraction
  const { data: noteRow } = await supabase
    .from("notes")
    .select("kg_last_extracted_at")
    .eq("id", params.noteId)
    .maybeSingle();
  if (noteRow?.kg_last_extracted_at) {
    const last = new Date(noteRow.kg_last_extracted_at).getTime();
    if (Date.now() - last < EXTRACTION_DEBOUNCE_MS) return null;
  }

  const extraction = await callExtractionModel(params.title, params.content);
  if (!extraction) return null;

  // Clear stale mentions/edges for this note before re-writing
  await deleteMentionsForNote(supabase, params.noteId);
  await deleteEdgesForNote(supabase, params.noteId);

  // Step 1: upsert entities, building a name+type → id map
  const entityMap = new Map<string, string>();
  let entitiesCreated = 0;

  for (const e of extraction.entities) {
    const key = `${e.name.toLowerCase()}::${e.type}`;
    if (entityMap.has(key)) continue;

    let existing = await findEntityByName(
      supabase,
      params.workspaceId,
      e.name,
      e.type
    );
    if (!existing) {
      existing = await createEntity(supabase, {
        workspace_id: params.workspaceId,
        name: e.name,
        entity_type: e.type,
        description: e.description,
      });
      entitiesCreated += 1;
    }
    entityMap.set(key, existing.id);
  }

  // Step 2: write mentions and bump mention_counts
  let mentionsCreated = 0;
  for (const e of extraction.entities) {
    const key = `${e.name.toLowerCase()}::${e.type}`;
    const entityId = entityMap.get(key);
    if (!entityId) continue;
    try {
      await createMention(supabase, {
        workspace_id: params.workspaceId,
        entity_id: entityId,
        note_id: params.noteId,
        surface_form: e.surface_form,
        context: e.context,
        branch_id: params.branchId ?? null,
      });
      await incrementMentionCount(supabase, entityId);
      mentionsCreated += 1;
    } catch (err) {
      console.error(
        "[knowledge_graph_service] mention write failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  // Step 3: write edges — only if both endpoints exist in the entity map
  let edgesCreated = 0;
  for (const edge of extraction.edges) {
    const srcKey = `${edge.source_name.toLowerCase()}::${edge.source_type}`;
    const tgtKey = `${edge.target_name.toLowerCase()}::${edge.target_type}`;
    const srcId = entityMap.get(srcKey);
    const tgtId = entityMap.get(tgtKey);
    if (!srcId || !tgtId || srcId === tgtId) continue;
    try {
      await createEdge(supabase, {
        workspace_id: params.workspaceId,
        source_entity_id: srcId,
        target_entity_id: tgtId,
        edge_type: edge.edge_type,
        confidence: Math.max(0, Math.min(1, edge.confidence ?? 1.0)),
        note_id: params.noteId,
        context: edge.context,
      });
      edgesCreated += 1;
    } catch (err) {
      console.error(
        "[knowledge_graph_service] edge write failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  // Stamp the extraction timestamp so the debounce window applies to
  // subsequent rapid saves.
  await supabase
    .from("notes")
    .update({ kg_last_extracted_at: new Date().toISOString() })
    .eq("id", params.noteId);

  return { entitiesCreated, mentionsCreated, edgesCreated };
}
