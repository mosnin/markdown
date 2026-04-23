# Knowledge Graph — v1

Entity-centric retrieval layer that complements the existing vector search (pgvector) and full-text search (tsvector). Extracts named entities and relationships from note content on save, stores them as a graph, and exposes a GraphRAG query API for agent context assembly.

## Why a graph

Vector search returns chunks that are semantically similar to a query. That is excellent for "find me notes about X" but fails on questions whose answer lives in relationships:

> "Which meetings led to the decision to deprecate service X?"

The answer is not any single chunk — it is a path through entities (meetings → decisions → service). The knowledge graph stores those entities and paths explicitly so questions over them become traversals.

## Subsystems

```
┌─────────────────────────────────────────────────────────────┐
│                         STORAGE                              │
│  entities · entity_mentions · entity_edges                   │
│  (Postgres, RLS scoped to workspace_memberships)             │
└─────────────────────────────────────────────────────────────┘
             ▲                                    ▲
             │ write                              │ read
┌────────────┴────────────┐       ┌──────────────┴───────────┐
│      WRITE PATH          │       │        READ PATH          │
│  saveNoteAction          │       │   graphRagQuery           │
│    └─ after()            │       │     └─ matchQueryEntities │
│       └─ extract…()      │       │     └─ listEdgesForEntity │
│          ├─ LLM call     │       │     └─ listMentionsBy…    │
│          ├─ resolve      │       │     └─ score + rank       │
│          ├─ persist      │       │   formatGraphRagContext   │
│          └─ log          │       │                           │
└──────────────────────────┘       └──────────────────────────┘
             │                                    │
             │                                    ▼
             │                       ┌──────────────────────────┐
             │                       │     POG INTEGRATION       │
             │                       │  startConversationTurn    │
             │                       │    └─ graphRagQuery(q)    │
             │                       │    └─ inject context into │
             │                       │       agent system prompt │
             │                       └──────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────┐
│                       UI LAYER                                │
│  /app/graph              — workspace-wide entity list         │
│  /app/entities/[id]      — one-hop connections + mentions     │
│  EntityChip              — typed, color-coded, linkable       │
│  NoteEntitiesPanel       — entities found in the current note │
└──────────────────────────────────────────────────────────────┘
```

## Data model

### `entities`
A named thing that recurs across notes. Deduplicated per-workspace by case-insensitive (name, type). Type is one of: `person`, `project`, `concept`, `organization`, `event`, `decision`, `other`.

| Column           | Type        | Notes                              |
|------------------|-------------|------------------------------------|
| id               | uuid PK     |                                    |
| workspace_id     | uuid FK     | cascade delete                     |
| name             | text        | canonical name                     |
| entity_type      | text        | enum via CHECK                     |
| description      | text        | one-sentence, LLM-produced         |
| mention_count    | int         | bumped atomically per mention      |
| first_seen_at    | timestamptz | first occurrence                   |
| last_seen_at     | timestamptz | most recent occurrence             |
| name_embedding   | vector(1536)| optional, for semantic dedup       |

Uniqueness: `(workspace_id, lower(name), entity_type)`.

### `entity_mentions`
Occurrence of an entity within a specific note. Surface form is the exact string used in the note ("the Q4 launch"). Context is the surrounding sentence for disambiguation.

| Column         | Type    | Notes                                 |
|----------------|---------|---------------------------------------|
| id             | uuid PK |                                       |
| workspace_id   | uuid FK |                                       |
| entity_id      | uuid FK | cascade delete                        |
| note_id        | uuid FK | cascade delete                        |
| surface_form   | text    | verbatim string from note             |
| context        | text    | ±1 sentence around the mention        |
| position_start | int     | optional char offset                  |
| position_end   | int     | optional char offset                  |
| branch_id      | uuid FK | set-null on branch delete             |

### `entity_edges`
Relationship between two entities, optionally sourced to the note where the relationship was discovered.

| Column            | Type    | Notes                                    |
|-------------------|---------|------------------------------------------|
| id                | uuid PK |                                          |
| workspace_id      | uuid FK |                                          |
| source_entity_id  | uuid FK | cascade delete                           |
| target_entity_id  | uuid FK | cascade delete                           |
| edge_type         | text    | enum: mentions / causes / decides / owns / relates_to / contradicts / supports / depends_on |
| confidence        | real    | 0–1, clamped at write time               |
| note_id           | uuid FK | set-null on note delete (keeps history)  |
| context           | text    | excerpt supporting the relationship      |

Uniqueness: `(source_entity_id, target_entity_id, edge_type, note_id)` — prevents duplicate edges from the same note.

## Write path

### Trigger
`saveNoteAction` in `src/app/app/notes/actions.ts` fires `extractAndStoreEntities()` via Next.js `after()` after the save row commits. This guarantees:

- Autosave UX never blocks on LLM latency (extraction is asynchronous w.r.t. the HTTP response).
- A failed extraction never corrupts the save — failures are logged and swallowed.

### Extraction
`src/server/services/knowledge_graph_service.ts → extractAndStoreEntities()`:

1. **LLM call** — `gpt-4o-mini` via the OpenAI-compatible `/chat/completions` endpoint (reusing `EMBEDDING_API_KEY` + `EMBEDDING_API_BASE_URL`). A strict JSON schema (`response_format.json_schema`) constrains output to `{entities: [...], edges: [...]}`. Temperature 0.
2. **Stale cleanup** — `deleteMentionsForNote()` and `deleteEdgesForNote()` clear the previous graph slice for this note. Entity rows persist (only mention_count is affected) so history isn't lost.
3. **Resolution** — for each extracted entity, `findEntityByName()` checks for an existing match by (lower name, type). Miss → `createEntity()`. Hit → reuse ID.
4. **Persist** — write `entity_mentions` rows, call the atomic `increment_entity_mention_count()` RPC, write `entity_edges` rows. Self-loops and missing endpoints are skipped.

### Feature gates
- **`EMBEDDING_API_KEY`** — if unset, `callExtractionModel()` returns `null` and the whole pipeline silently no-ops. Extraction degrades gracefully.
- **`workspace.knowledge_graph_enabled`** (added in `20260423000002`) — per-workspace opt-out for privacy-sensitive data. Extraction checks this flag and skips when false.
- **Autosave debounce** — extraction is skipped when `last_extracted_at` on the note is within 30 seconds to cap LLM cost during rapid autosaves.

### Concurrency
`mention_count` increments use a Postgres stored procedure (`increment_entity_mention_count`) that performs an atomic `UPDATE entities SET mention_count = mention_count + 1` in a single statement. This replaces the original read-then-write pattern that could lose counts under concurrent saves.

## Read path — GraphRAG

`src/server/services/graph_rag_service.ts → graphRagQuery()`:

1. **Load entities** — fetch up to 500 most-mentioned entities for the workspace.
2. **Match** — word-boundary regex of entity names against the query string, ranked by mention_count + length (longer names are more specific).
3. **Expand** — for each matched entity, traverse one hop via `listEdgesForEntity()` to collect connected entity IDs.
4. **Collect mentions** — for every entity in the expanded set, fetch `entity_mentions` rows (bounded to 50 per entity).
5. **Score** — direct matches score 2.0×, indirect matches 1.0×; scores accumulate when multiple matched entities share a note; `log1p(mention_count) × 0.1` adjustment rewards entities that appear frequently.
6. **Rank and return** — top 12 notes by score, each with a human-readable rationale string (`"Mentions Alice; links to Q4 Launch"`).

### `formatGraphRagContext(result)`
Renders the result as a compact `## Knowledge Graph Context` block suitable for prepending to an agent system prompt. Used by Pog integration (below).

## Pog integration

`startConversationTurnAction` in `src/app/app/conversation/actions.ts`:

1. Before dispatching the run to Modal, run `graphRagQuery(supabase, workspaceId, prompt, { maxHops: 1, maxHits: 8 })`.
2. If the result has hits, prepend `formatGraphRagContext(result)` to the agent system prompt.
3. Additionally, load the top 20 most-mentioned workspace entities and include them as "Workspace vocabulary:" so the agent uses the user's actual terminology.

Falls back silently when the graph is empty (new workspace, extraction disabled, etc.).

## UI surfaces

- **`/app/graph`** — filterable list of all entities, grouped by type. Entry point.
- **`/app/entities/[entity_id]`** — one entity's full detail: description, one-hop connections with edge types and arrows, every note that mentions it with context snippet.
- **`EntityChip`** — typed pill with per-type icon and color (blue=person, violet=project, amber=concept, emerald=org, rose=event, indigo=decision). Used everywhere an entity name is rendered.
- **`NoteEntitiesPanel`** *(sub-phase 1G)* — sidebar panel on the note detail page showing entities extracted from the current note.
- **Visual graph** *(sub-phase 1I)* — force-directed node-link diagram using `react-force-graph-2d`; node size proportional to mention_count, edge thickness proportional to edge confidence.

## Operations

### Migrations
- `20260423000001_knowledge_graph.sql` — tables, RLS, indexes.
- `20260423000002_knowledge_graph_safety.sql` — atomic RPC, workspace flag, entity embedding column.

### Environment
| Variable | Purpose | Required? |
|----------|---------|-----------|
| `EMBEDDING_API_KEY` | LLM extraction + embeddings | Yes for KG to do anything |
| `EMBEDDING_API_BASE_URL` | OpenAI-compatible endpoint | Defaults to `https://api.openai.com/v1` |

### Backfill
New workspaces populate the graph over days as users save notes. Existing workspaces need a one-shot backfill: `POST /api/internal/kg/backfill` (workspace-admin scoped) iterates all notes in batches of 20 and runs the same extraction pipeline. Tracked via a `knowledge_graph_backfill_jobs` table (added in sub-phase 1F).

### Cost model
Per note save, one call to `gpt-4o-mini` with ~8k tokens input and ~2k tokens output. At current pricing that is ~$0.002 per save. The 30-second autosave debounce and workspace opt-out keep this bounded. Backfill of 1000 existing notes costs ~$2.

---

## Atomic insights

A parallel extraction pipeline that captures propositional claims — distinct from named entities which capture who/what.

### What is an insight

An insight is a single verifiable claim lifted from a note. Categories:

| Category | Meaning | Example |
|---|---|---|
| `fact` | Objective observation | "pgvector is Postgres-native" |
| `decision` | A choice that was made | "We chose Postgres over Mongo" |
| `insight` | Synthesized understanding | "The bottleneck is I/O not CPU" |
| `question` | Open investigation | "Does HNSW handle 1M vectors well?" |
| `action` | Intended work | "Migrate auth to WebAuthn by Q4" |

### `insights` table

Migration: `20260423000004_atomic_insights.sql`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid FK | cascade delete |
| `note_id` | uuid FK | cascade delete |
| `claim` | text | the extracted claim, ~1–2 sentences |
| `category` | text | fact / decision / insight / question / action |
| `confidence` | real (0–1) | model confidence, clamped at write time |
| `source_excerpt` | text | supporting passage from the note |
| `created_at` / `updated_at` | timestamptz | |

RLS: all workspace members can read and write (same workspace_memberships check as entities).

### Extraction

Insights are extracted alongside entities in `knowledge_graph_service.ts`. The same LLM call that extracts entities also populates an `insights` array in the JSON response schema. On save:

1. Old insights for the note are deleted.
2. New insights are inserted with confidence from the model response.
3. If extraction returns no insights (short note, extraction disabled), the note is left with zero insights — not an error.

### UI: `/app/insights`

The insights page shows a feed of all insights in the workspace, filterable by category. Each row shows: the claim, its category badge, source note link, and confidence. Click the note link to open the note.

---

## KG backfill jobs

New workspaces accumulate the knowledge graph incrementally as notes are saved. Workspaces migrated in from older versions need a one-time backfill run to process existing notes.

### `kg_backfill_jobs` table

Migration: `20260423000003_kg_backfill_jobs.sql`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid FK | |
| `triggered_by` | uuid FK auth.users | |
| `status` | text | pending / running / completed / failed / cancelled |
| `total_notes` | int | total notes to process |
| `processed_notes` | int | notes processed so far |
| `failed_notes` | int | notes that failed extraction |
| `started_at` / `completed_at` | timestamptz | |
| `error` | text | null on success |

### Running a backfill

`POST /api/internal/kg/backfill` (workspace-admin scoped): creates a `kg_backfill_jobs` row and processes all notes in batches of 20, calling the same extraction pipeline as on-save. The job row is updated incrementally so the settings UI can show a progress bar.

A workspace can have only one active backfill job at a time (enforced at the service layer, not DB). Starting a new job when one is `running` returns `409 Conflict`.

---

## Extension points

Future work:

- **Merge/alias** — `mergeEntities(sourceId, targetId)` service + UI on entity detail page for deduplicating variants ("GPT-4" vs "gpt4").
- **Insight deduplication** — cross-note semantic dedup of structurally similar claims using the embedding column.
- **Insight querying in GraphRAG** — surface relevant insights in the `formatGraphRagContext` block alongside entity context.
