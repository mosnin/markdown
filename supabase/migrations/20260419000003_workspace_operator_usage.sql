-- =============================================================================
-- Workspace Operator usage — monthly rollup of runs + tokens + cost per user.
-- Migration: 20260419000003_workspace_operator_usage.sql
--
-- Phase 4 of the Workspace Operator introduces metered usage tracking. Every
-- completed (or failed) Operator run contributes to this table's row for
-- (workspace_id, user_id, month). The UI surfaces these aggregates in the
-- billing settings panel; admins get a per-workspace cost rollup.
--
-- Writes are service-role only (see `workspace_subscriptions` rollup pattern
-- in 20260410000001_fix_workspace_subscriptions.sql). The service layer
-- upserts into this table from server actions — users never insert directly.
-- =============================================================================

create table public.workspace_operator_usage (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  month                 date NOT NULL,                     -- first day of the month (UTC)
  run_count             integer NOT NULL DEFAULT 0,
  tool_call_count       integer NOT NULL DEFAULT 0,
  input_token_count     integer NOT NULL DEFAULT 0,
  output_token_count    integer NOT NULL DEFAULT 0,
  estimated_cost_cents  integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, month)
);

CREATE INDEX workspace_operator_usage_workspace_month_idx
  ON public.workspace_operator_usage (workspace_id, month DESC);

CREATE INDEX workspace_operator_usage_user_month_idx
  ON public.workspace_operator_usage (user_id, month DESC)
  WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- updated_at trigger — uses the existing public.set_updated_at() function
-- defined in the core schema (20260409000001_core_schema.sql).
-- ---------------------------------------------------------------------------

CREATE TRIGGER workspace_operator_usage_set_updated_at
  BEFORE UPDATE ON public.workspace_operator_usage
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — workspace members can read; writes are service-role only.
--
--   * SELECT: any workspace member can read the workspace's usage rows via
--     public.owns_workspace(wid). Usage is team-visible by design — it's
--     part of the billing / quota story shown in settings.
--   * INSERT / UPDATE / DELETE: deny-all for authenticated; the service
--     role (server-side workspace_operator_usage_service) is the only
--     writer. This mirrors the workspace_subscriptions lockdown.
-- ---------------------------------------------------------------------------

ALTER TABLE public.workspace_operator_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_operator_usage_member_select
  ON public.workspace_operator_usage
  FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY workspace_operator_usage_no_direct_insert
  ON public.workspace_operator_usage
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY workspace_operator_usage_no_direct_update
  ON public.workspace_operator_usage
  FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY workspace_operator_usage_no_direct_delete
  ON public.workspace_operator_usage
  FOR DELETE
  TO authenticated
  USING (false);
