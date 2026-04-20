-- =============================================================================
-- Context Store — Branch lifecycle + auto-cleanup
-- Migration: 20260414000004_branch_lifecycle.sql
--
-- Feature #8 adds workspace-level retention policies for draft branches, idle
-- detection, and opt-in auto-discard after a warning period.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.workspace_branch_retention_policies (
  workspace_id              uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  auto_discard_after_days   integer NOT NULL DEFAULT 60
                                    CHECK (auto_discard_after_days > 0),
  warn_after_idle_days      integer NOT NULL DEFAULT 30
                                    CHECK (warn_after_idle_days > 0),
  enabled                   boolean NOT NULL DEFAULT false,
  updated_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (auto_discard_after_days >= warn_after_idle_days)
);

ALTER TABLE public.draft_branches
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_warned_at   timestamptz,
  ADD COLUMN IF NOT EXISTS warning_count    integer NOT NULL DEFAULT 0;

UPDATE public.draft_branches
   SET last_activity_at = created_at
 WHERE last_activity_at IS NULL;

CREATE INDEX IF NOT EXISTS draft_branches_last_activity_idx
  ON public.draft_branches (workspace_id, status, last_activity_at);

ALTER TABLE public.workspace_branch_retention_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_branch_retention_member_select
  ON public.workspace_branch_retention_policies
  FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY workspace_branch_retention_admin_insert
  ON public.workspace_branch_retention_policies
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_admin_workspace(workspace_id));

CREATE POLICY workspace_branch_retention_admin_update
  ON public.workspace_branch_retention_policies
  FOR UPDATE
  TO authenticated
  USING (public.can_admin_workspace(workspace_id))
  WITH CHECK (public.can_admin_workspace(workspace_id));

CREATE POLICY workspace_branch_retention_admin_delete
  ON public.workspace_branch_retention_policies
  FOR DELETE
  TO authenticated
  USING (public.can_admin_workspace(workspace_id));

CREATE TRIGGER workspace_branch_retention_set_updated_at
  BEFORE UPDATE ON public.workspace_branch_retention_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
