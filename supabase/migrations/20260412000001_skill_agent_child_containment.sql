-- Migration: skill_agent_child_containment
--
-- Purpose: Enable reusable workspace-level skills and agents to have child
-- folders, and add direct FK containment columns for skill/agent children.
--
-- Changes:
-- 1. Add workspace_id to folders (back-populated from boxes.workspace_id)
-- 2. Make folders.box_id nullable (was NOT NULL)
-- 3. Add parent_skill_id and parent_agent_id FK columns to files
-- 4. Add parent_skill_id and parent_agent_id FK columns to folders
--
-- This enables:
-- - Reusable workspace-level skills/agents to own child folders directly
-- - Direct FK containment queries (SELECT * FROM files WHERE parent_skill_id = ?)
--   in addition to the existing object_links approach
--
-- Constraints preserved:
-- - Existing folders with box_id remain valid
-- - New workspace-level folders require workspace_id (NOT NULL)
-- - FK columns are nullable (most files/folders are NOT skill/agent children)
-- - No existing data is modified except adding the workspace_id column

-- ─── 1. Add workspace_id to folders ──────────────────────────────────────────

ALTER TABLE public.folders
  ADD COLUMN IF NOT EXISTS workspace_id uuid;

-- Back-populate workspace_id from boxes.workspace_id for all existing folders
UPDATE public.folders f
  SET workspace_id = b.workspace_id
  FROM public.boxes b
  WHERE f.box_id = b.id
    AND f.workspace_id IS NULL;

-- Now make workspace_id NOT NULL
ALTER TABLE public.folders
  ALTER COLUMN workspace_id SET NOT NULL;

-- Add FK constraint
ALTER TABLE public.folders
  ADD CONSTRAINT folders_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- ─── 2. Make folders.box_id nullable ─────────────────────────────────────────

ALTER TABLE public.folders
  ALTER COLUMN box_id DROP NOT NULL;

-- ─── 3. Add parent_skill_id and parent_agent_id to files ─────────────────────

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS parent_skill_id uuid REFERENCES public.skills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL;

-- ─── 4. Add parent_skill_id and parent_agent_id to folders ───────────────────

ALTER TABLE public.folders
  ADD COLUMN IF NOT EXISTS parent_skill_id uuid REFERENCES public.skills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL;

-- ─── 5. Indexes for FK lookups ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_files_parent_skill_id ON public.files (parent_skill_id)
  WHERE parent_skill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_files_parent_agent_id ON public.files (parent_agent_id)
  WHERE parent_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_folders_parent_skill_id ON public.folders (parent_skill_id)
  WHERE parent_skill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_folders_parent_agent_id ON public.folders (parent_agent_id)
  WHERE parent_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_folders_workspace_id ON public.folders (workspace_id);

-- ─── 6. RLS policy for workspace-level folders (no box_id) ───────────────────

-- The existing RLS policies on folders check box ownership via box_id.
-- Workspace-level folders (box_id IS NULL) need a direct workspace_id check.
CREATE POLICY folders_workspace_select ON public.folders
  FOR SELECT USING (
    box_id IS NULL
    AND workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY folders_workspace_insert ON public.folders
  FOR INSERT WITH CHECK (
    box_id IS NULL
    AND workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY folders_workspace_update ON public.folders
  FOR UPDATE USING (
    box_id IS NULL
    AND workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY folders_workspace_delete ON public.folders
  FOR DELETE USING (
    box_id IS NULL
    AND workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
    )
  );
