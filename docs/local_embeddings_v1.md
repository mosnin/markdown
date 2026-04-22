# Local Embeddings — v1 (On-device Inference)

Zero-API-cost semantic search and predictive retrieval using `@huggingface/transformers` running `all-MiniLM-L6-v2` inside a WebWorker. Embeddings are stored in IndexedDB and queried with pure-JS cosine similarity. Falls back silently to server-side pgvector search when the browser lacks WebWorker support or when the local index hasn't been built yet.

## Why on-device

| Concern | Server-side pgvector | On-device (this phase) |
|---------|---------------------|------------------------|
| Latency | ~100–300ms round-trip | ~5ms after model loaded |
| Cost per query | EMBEDDING_API_KEY tokens | Zero |
| Offline support | ❌ | ✓ |
| Privacy | Note content leaves device | Stays in browser |
| First-load | Instant (index exists) | Model download once (~22 MB cached) |

The two approaches are complementary. Server-side search serves as ground truth and handles the initial load state. On-device search enhances with faster results once the local index is warm.

## Subsystem map

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER MAIN THREAD                        │
│                                                               │
│  useNoteEmbedding()  ──embed on save──►  EmbeddingClient    │
│                                              │                │
│  useLocalSearch()    ──query──►  NoteVectorStore             │
│      │                              │                         │
│      ▼                              ▼                         │
│  SearchPage          ◄── hits ──  IndexedDB                  │
│  EditorPredictivePanel               ▲                        │
└─────────────────────────────────────│────────────────────────┘
                                      │ store vectors
┌─────────────────────────────────────│────────────────────────┐
│                    WEB WORKER                                  │
│                                                               │
│  EmbeddingWorker                                              │
│    ├── load @huggingface/transformers (WASM / WebGPU)        │
│    ├── cache model weights via Cache API                      │
│    └── embed(texts[]) → Float32Array[]                       │
└─────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Purpose |
|---------|---------|
| `@huggingface/transformers` | On-device inference engine (WASM + optional WebGPU) |
| `idb-keyval` | Thin IndexedDB wrapper for vector persistence |

## Components

### `src/lib/embedding/embedding_worker.ts`
Web Worker entry. Loads the `all-MiniLM-L6-v2` pipeline once (subsequent calls reuse the cached pipeline). Responds to `{ type: 'embed', id, texts }` messages with `{ type: 'result', id, vectors }`. Errors surface as `{ type: 'error', id, message }`.

Model weights are cached via the Transformers.js `env.cacheDir` (defaults to Cache API `transformers-cache`). A cold start downloads ~22 MB once; subsequent starts are instant.

### `src/lib/embedding/embedding_client.ts`
Singleton that manages the worker lifecycle. Exposes:
- `EmbeddingClient.getInstance()` → singleton
- `client.embed(texts: string[]): Promise<number[][]>` — queues requests, resolves via promise map keyed on request id
- `client.isReady(): boolean` — true after worker ACK
- Worker is created lazily on first call; a failed worker logs and rejects all pending promises (callers fall back to server search)

### `src/lib/embedding/note_vector_store.ts`
IndexedDB-backed vector store. Schema: key = `noteId`, value = `Float32Array(384)`.
- `storeVector(noteId, vector)` — upsert
- `deleteVector(noteId)` — on note delete
- `queryTopK(queryVector, k, workspaceNoteIds)` — pure-JS cosine similarity over all indexed notes, returns top-k `{noteId, score}[]`
- `getIndexedNoteIds()` — for staleness detection

### `src/hooks/use_note_embedding.ts`
Client hook. Called from the note editor after a successful save. Embeds `title + content.slice(0, 1000)` and stores the vector in IndexedDB. Debounced 5s to avoid hammering the worker on rapid autosaves. No-ops if `EmbeddingClient` is unavailable.

### `src/hooks/use_local_search.ts`
Client hook. Takes a query string, debounces 300ms, embeds the query, and queries `NoteVectorStore` for top-12 results. Returns `{ hits: LocalSearchHit[], status: 'idle'|'loading'|'ready'|'error' }`. `status='ready'` only after the worker has loaded; before that returns `hits=[]`.

### `src/components/product/local_search_results.tsx`
Companion UI to `/app/search`. Renders a "Local (on-device)" section beneath the server results with a `Cpu` icon badge. Lazy-loaded (`ssr: false`) so it never blocks SSR.

### `src/components/product/editor_related_panel.tsx`
Predictive panel in the note editor. While the user types, debounces 800ms then fires `useLocalSearch` with the current note's title. Shows up to 5 related notes in a collapsible aside panel. Skips render if `hits.length === 0` (no distraction when there's nothing to show).

## Model details

- **Model**: `Xenova/all-MiniLM-L6-v2` (available via `@huggingface/transformers`)
- **Dimensions**: 384
- **WASM size**: ~22 MB (cached after first load)
- **Inference time**: ~5ms per note on a modern CPU (WASM), ~1ms with WebGPU
- **Similarity**: cosine (dot product after L2 normalization)

## Fallback strategy

Three layers:
1. **No Worker support** — `typeof Worker === 'undefined'` (SSR or very old browser): client returns `status='error'`, callers skip local results entirely.
2. **Worker crash** — any uncaught error in the worker: `EmbeddingClient` rejects pending promises, clears the singleton, surfaces `status='error'`. UI hides the local section.
3. **No IndexedDB** — `NoteVectorStore` methods throw: caught silently, local search returns empty.

Server-side pgvector search is always shown first and is unaffected by local search failures.

## Privacy

Note text sent to the worker never leaves the browser. The worker communicates only with the Transformers.js WASM module. The only network request is the one-time model weight download from `huggingface.co` (or a self-hosted mirror via `env.remotePathTemplate`).

## Progressive indexing

On first load, the local index is empty. Indexing builds over time as the user saves notes (via `useNoteEmbedding`). For fast full-index bootstrap, `/app/search` kicks off a background indexing pass on mount: fetches the user's note list, filters out already-indexed IDs, and embeds in batches of 10. This gives ~95% coverage within 2 minutes for a 500-note workspace.

## Environment

No new environment variables. The worker uses `@huggingface/transformers` defaults (downloads from `https://huggingface.co`). To self-host model weights, set `env.remotePathTemplate` inside the worker before pipeline initialization.

## What this does NOT ship

- **Multi-lingual models** — `all-MiniLM-L6-v2` is English-first. Multi-lingual variant deferred.
- **Incremental HNSW index** — querying 50k notes via brute-force cosine is ~50ms. HNSW needed at scale.
- **Sync across devices** — the IndexedDB index is per-device. Cross-device sync deferred.
