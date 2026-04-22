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

## Extension points

The sub-phases in `/docs/knowledge_graph_roadmap.md` plug into the spots below:

- **1E (Pog integration)** — `startConversationTurnAction` prompt assembly.
- **1F (Backfill)** — new API route + job-tracking table + settings UI button.
- **1G (Editor panel)** — server-rendered `listMentionsByNote()` → client `NoteEntitiesPanel`.
- **1H (Merge/alias)** — new `mergeEntities(sourceId, targetId)` service + UI on entity detail page.
- **1I (Force-directed viz)** — `/app/graph` gains a "Visual" tab wired to `react-force-graph-2d`.
- **1J (Atomic insights)** — parallel extraction pipeline writing to `insights` + `insight_mentions` tables; graph retains entities, insights retain claims.
