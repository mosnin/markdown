-- Knowledge graph for entity-centric retrieval.
--
-- Entities are people, projects, concepts, organizations, events, decisions
-- extracted from note content by an LLM pipeline on save. Mentions link
-- entities back to the notes they appear in. Edges capture relationships
-- between entities (e.g. "Q4 Launch" owns_by "Alice").
--
-- Combined with pgvector, this enables GraphRAG retrieval: find the entity
-- for a query, traverse related entities, and surface the notes that
-- mention them.

CREATE TABLE IF NOT EXISTS public.entities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  entity_type     text NOT NULL CHECK (entity_type IN ('person','project','concept','organization','event','decision','other')),
  description     text,
  mention_count   integer NOT NULL DEFAULT 0,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive dedupe by (workspace, lower(name), type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_workspace_name_type
  ON public.entities (workspace_id, lower(name), entity_type);

CREATE INDEX IF NOT EXISTS idx_entities_workspace_type ON public.entities (workspace_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_last_seen     ON public.entities (workspace_id, last_seen_at DESC);

CREATE TRIGGER entities_updated_at
  BEFORE UPDATE ON public.entities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members read entities"
  ON public.entities FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));
CREATE POLICY "workspace members write entities"
  ON public.entities FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));

-- ─── Mentions: entity ↔ note links ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entity_mentions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_id       uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  note_id         uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  surface_form    text NOT NULL,
  context         text,
  position_start  integer,
  position_end    integer,
  branch_id       uuid REFERENCES public.draft_branches(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mentions_entity     ON public.entity_mentions (entity_id);
CREATE INDEX IF NOT EXISTS idx_mentions_note       ON public.entity_mentions (note_id);
CREATE INDEX IF NOT EXISTS idx_mentions_workspace  ON public.entity_mentions (workspace_id);

ALTER TABLE public.entity_mentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members read mentions"
  ON public.entity_mentions FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));
CREATE POLICY "workspace members write mentions"
  ON public.entity_mentions FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));

-- ─── Edges: entity ↔ entity relationships ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entity_edges (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_entity_id  uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  target_entity_id  uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  edge_type         text NOT NULL CHECK (edge_type IN ('mentions','causes','decides','owns','relates_to','contradicts','supports','depends_on')),
  confidence        real NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  note_id           uuid REFERENCES public.notes(id) ON DELETE SET NULL,
  context           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Prevent duplicate identical edges from the same source note
CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique
  ON public.entity_edges (source_entity_id, target_entity_id, edge_type, COALESCE(note_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_edges_source     ON public.entity_edges (source_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_target     ON public.entity_edges (target_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_workspace  ON public.entity_edges (workspace_id);

ALTER TABLE public.entity_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members read edges"
  ON public.entity_edges FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));
CREATE POLICY "workspace members write edges"
  ON public.entity_edges FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));

COMMENT ON TABLE public.entities         IS 'Named entities extracted from note content for GraphRAG retrieval';
COMMENT ON TABLE public.entity_mentions  IS 'Occurrences of an entity within a specific note, with surface form and context';
COMMENT ON TABLE public.entity_edges     IS 'Relationships between entities discovered during extraction';
