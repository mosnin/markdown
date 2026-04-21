-- Add is_public flag to boxes for profile page sharing
ALTER TABLE public.boxes ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

-- Index for profile page queries (workspace + public)
CREATE INDEX IF NOT EXISTS boxes_workspace_public_idx ON public.boxes (workspace_id, is_public) WHERE is_public = true;

-- RLS: anyone can read public boxes (no auth required)
CREATE POLICY "Public boxes are readable by anyone"
  ON public.boxes
  FOR SELECT
  USING (is_public = true);
