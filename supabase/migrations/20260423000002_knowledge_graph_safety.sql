-- Knowledge graph safety + cost-control additions.
--
-- Follows 20260423000001_knowledge_graph.sql. Three concerns addressed:
--
--   1. Mention-count race condition. The v1 service used read-then-write
--      to bump mention_count, which loses updates under concurrent saves.
--      Replaced with a stored procedure that increments atomically.
--
--   2. Privacy opt-out. Adds workspace.knowledge_graph_enabled (default
--      true) so privacy-sensitive workspaces can disable extraction. The
--      service checks this before calling the LLM.
--
--   3. Autosave cost cap. Adds notes.kg_last_extracted_at so the service
--      can skip re-extraction when a note was processed within the last
--      30 seconds. Stops rapid autosaves from racking up LLM cost.
--
--   4. Semantic dedup foundation. Adds entities.name_embedding so future
--      merging/alias resolution can use cosine similarity instead of pure
--      text match ("VP of Sales" ≈ "Head of Sales").

-- ─── 1. Atomic mention count increment ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_entity_mention_count(p_entity_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.entities
     SET mention_count = mention_count + 1,
         last_seen_at  = now()
   WHERE id = p_entity_id;
$$;

COMMENT ON FUNCTION public.increment_entity_mention_count IS
  'Atomically bump mention_count + last_seen_at on an entity. Use instead of read-then-write to avoid lost updates under concurrent note saves.';

-- ─── 2. Workspace opt-out flag ───────────────────────────────────────────
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS knowledge_graph_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.workspaces.knowledge_graph_enabled IS
  'When false, the knowledge-graph extraction pipeline is skipped for notes in this workspace. Used for privacy-sensitive data.';

-- ─── 3. Per-note extraction throttle ─────────────────────────────────────
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS kg_last_extracted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_notes_kg_last_extracted
  ON public.notes (kg_last_extracted_at)
  WHERE kg_last_extracted_at IS NOT NULL;

COMMENT ON COLUMN public.notes.kg_last_extracted_at IS
  'Timestamp of the most recent knowledge-graph extraction run for this note. The service skips re-extraction within a 30-second debounce window.';

-- ─── 4. Entity name embeddings (for semantic dedup later) ────────────────
-- Guard: pgvector may not be installed; skip if unavailable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS name_embedding vector(1536)';
  END IF;
END $$;

-- HNSW index is only created when the column + extension both exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name   = 'entities'
               AND column_name  = 'name_embedding') THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS idx_entities_name_embedding_hnsw
        ON public.entities USING hnsw (name_embedding vector_cosine_ops)
     $idx$;
  END IF;
END $$;
