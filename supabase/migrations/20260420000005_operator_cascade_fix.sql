-- =============================================================================
-- Operator cascade fix — GDPR / data-deletion correctness pass.
-- Migration: 20260420000005_operator_cascade_fix.sql
--
-- Audit of the Phase-5 Workspace Operator tables found ONE foreign key whose
-- ON DELETE action did not match the project's deletion policy:
--
--   workspace_operator_runs.user_id  CASCADE  -> needs SET NULL
--
-- Policy (see audit guard at src/tests/unit/operator_cascade_audit.test.ts):
--
--   * workspace_id FKs           -> ON DELETE CASCADE
--       Workspace deletion wipes everything inside the workspace; orphan
--       rows would leak data and violate the workspace's RLS contract.
--
--   * user_id FKs on personal data (saved prompts, API keys, notification
--     preferences)                -> ON DELETE CASCADE
--       The row is meaningless without its owner; user deletion (account
--       erasure / GDPR Article 17) must take it with them.
--
--   * user_id FKs on RUN HISTORY (workspace_operator_runs) -> ON DELETE
--     SET NULL
--       Run history is an audit trail — workspace admins still need to see
--       "this run was kicked off, produced these notes, cost $X" after the
--       actor leaves. Anonymising user_id satisfies GDPR (the personal
--       identifier is gone) while preserving the operational record.
--
-- All other FKs audited (workspace_operator_runs.workspace_id,
-- workspace_operator_prompts.{workspace_id,user_id},
-- operator_api_keys.{workspace_id,user_id},
-- operator_notification_preferences.user_id) already match the policy and
-- are NOT touched here.
--
-- ---------------------------------------------------------------------------
-- ACCEPTED RISK — orphaned-run visibility (security review #3)
-- ---------------------------------------------------------------------------
-- After this change, a run whose originating user has been deleted will
-- retain `user_id = NULL` and remain visible to workspace admins through
-- the run-history UI. This is the intended audit-trail behaviour: admins
-- must still be able to account for historical compute spend and notes
-- created by ex-members. The personal identifier (user_id) is gone,
-- satisfying GDPR erasure requirements; the operational row survives.
-- Product is aware and has signed off; the RLS policy on this table
-- already scopes visibility to workspace members only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- workspace_operator_runs.user_id : CASCADE -> SET NULL
--
-- The original migration (20260419000001) declared the column NOT NULL with
-- ON DELETE CASCADE. To switch to SET NULL we must:
--   1. Drop the NOT NULL so the column can hold the anonymised value.
--   2. Replace the FK constraint.
--
-- The constraint name `workspace_operator_runs_user_id_fkey` is the Postgres
-- default for an inline `REFERENCES` clause and is what the original
-- CREATE TABLE produced.
-- ---------------------------------------------------------------------------

ALTER TABLE public.workspace_operator_runs
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.workspace_operator_runs
  DROP CONSTRAINT workspace_operator_runs_user_id_fkey;

ALTER TABLE public.workspace_operator_runs
  ADD CONSTRAINT workspace_operator_runs_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON DELETE SET NULL;
