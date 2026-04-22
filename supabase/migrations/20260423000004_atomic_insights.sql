-- Atomic insights: standalone claims extracted from note content.
--
-- Parallel to the entity/mention/edge graph but captures propositional
-- content rather than named entities. An insight is a single, verifiable
-- claim linked to the note it was derived from.
--
-- Categories:
--   fact      — objective observation ("pgvector is Postgres-native")
--   decision  — choice made ("We chose Postgres over Mongo")
--   insight   — synthesized understanding ("The bottleneck is I/O not CPU")
--   question  — open investigation ("Does HNSW handle 1M vectors well?")
--   action    — intended work ("Migrate auth to WebAuthn by Q4")

CREATE TABLE IF NOT EXISTS public.insights (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  note_id        uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  claim          text NOT NULL,
  category       text NOT NULL CHECK (category IN ('fact','decision','insight','question','action')),
  confidence     real NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  source_excerpt text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insights_workspace ON public.insights (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_note      ON public.insights (note_id);
CREATE INDEX IF NOT EXISTS idx_insights_category  ON public.insights (workspace_id, category);

CREATE TRIGGER insights_updated_at
  BEFORE UPDATE ON public.insights
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members read insights"
  ON public.insights FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));

CREATE POLICY "workspace members write insights"
  ON public.insights FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));

COMMENT ON TABLE public.insights IS
  'Atomic claims extracted from note content by the insights extraction pipeline. Queryable independent of the containing note.';
