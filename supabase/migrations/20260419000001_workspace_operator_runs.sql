-- =============================================================================
-- Workspace Operator runs — durable record of every Operator invocation
-- Migration: 20260419000001_workspace_operator_runs.sql
--
-- The Workspace Operator (see src/server/services/workspace_operator_service.ts)
-- previously generated a transient run_id with randomUUID() at dispatch time
-- and forgot it when the request returned. This migration introduces a
-- canonical row per run so the UI can:
--
--   * list a user's recent runs across workspaces
--   * resume / inspect an in-flight or completed run
--   * gate replays / cancellations behind RLS
--
-- The status enum mirrors the OperatorRunPhase union shipped to the client
-- (see src/app/app/workspace_operator/types.ts) so the DB and UI agree on
-- vocabulary. `plan` and `result` jsonb columns capture the approved plan and
-- the final OperatorResult payload respectively for forensic / replay use.
-- =============================================================================

create table public.workspace_operator_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  branch_id       uuid REFERENCES public.draft_branches(id) ON DELETE SET NULL,
  prompt          text NOT NULL,
  mode            text NOT NULL
                       CHECK (mode IN ('plan', 'execute', 'full')),
  status          text NOT NULL DEFAULT 'queued'
                       CHECK (status IN (
                         'queued',
                         'planning',
                         'awaiting_approval',
                         'executing',
                         'completed',
                         'failed',
                         'cancelled'
                       )),
  plan            jsonb,
  result          jsonb,
  error           text,
  notes_created   uuid[] DEFAULT '{}',
  tool_calls      integer DEFAULT 0,
  duration_ms     integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workspace_operator_runs_workspace_idx
  ON public.workspace_operator_runs (workspace_id, created_at DESC);
CREATE INDEX workspace_operator_runs_user_idx
  ON public.workspace_operator_runs (user_id, created_at DESC);
CREATE INDEX workspace_operator_runs_branch_idx
  ON public.workspace_operator_runs (branch_id)
  WHERE branch_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- updated_at trigger — uses the existing public.set_updated_at() function
-- defined in the core schema (20260409000001_core_schema.sql).
-- ---------------------------------------------------------------------------

CREATE TRIGGER workspace_operator_runs_set_updated_at
  BEFORE UPDATE ON public.workspace_operator_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — workspace-scoped reads, owner-or-admin writes.
--
--   * SELECT: any workspace member can read the workspace's runs. We use
--     public.owns_workspace(wid) which returns true for any membership role
--     (viewer, member, admin) — the same gate every other workspace-scoped
--     table uses (see link_suggestions, note_comments).
--   * INSERT / UPDATE / DELETE: the run's user_id (the actor who kicked it
--     off) OR a workspace admin. Mirrors the pattern in note_comments where
--     the author + admin both have write rights on the row.
-- ---------------------------------------------------------------------------

ALTER TABLE public.workspace_operator_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_operator_runs_member_select
  ON public.workspace_operator_runs
  FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY workspace_operator_runs_actor_insert
  ON public.workspace_operator_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.owns_workspace(workspace_id)
  );

CREATE POLICY workspace_operator_runs_actor_update
  ON public.workspace_operator_runs
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.can_admin_workspace(workspace_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.can_admin_workspace(workspace_id)
  );

CREATE POLICY workspace_operator_runs_actor_delete
  ON public.workspace_operator_runs
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.can_admin_workspace(workspace_id)
  );
