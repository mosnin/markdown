-- Job-tracking table for knowledge-graph backfill runs.
--
-- Each row represents one invocation of the backfill pipeline for a
-- workspace. Lets the UI show progress and resume if interrupted.

CREATE TABLE IF NOT EXISTS public.kg_backfill_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  triggered_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
  total_notes      integer NOT NULL DEFAULT 0,
  processed_notes  integer NOT NULL DEFAULT 0,
  failed_notes     integer NOT NULL DEFAULT 0,
  started_at       timestamptz,
  completed_at     timestamptz,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kg_backfill_workspace ON public.kg_backfill_jobs (workspace_id, created_at DESC);

CREATE TRIGGER kg_backfill_jobs_updated_at
  BEFORE UPDATE ON public.kg_backfill_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.kg_backfill_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members read backfill jobs"
  ON public.kg_backfill_jobs FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));
CREATE POLICY "workspace members manage backfill jobs"
  ON public.kg_backfill_jobs FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));
