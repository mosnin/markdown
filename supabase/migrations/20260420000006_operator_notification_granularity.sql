-- =============================================================================
-- Operator notification granularity — adds per-event opt-ins on top of the
-- binary (complete / fail) shape from 20260420000003.
-- Migration: 20260420000006_operator_notification_granularity.sql
--
-- Three new boolean columns on public.operator_notification_preferences:
--
--   * email_on_approval_needed  — fires when a plan-mode run transitions to
--                                  `awaiting_approval` so the user can review
--                                  the plan without babysitting the panel.
--   * email_on_cancel           — fires when a run is cancelled (user-initiated
--                                  cancellation; see cancelRunAction). Default
--                                  OFF because the user *just asked for it* —
--                                  they probably don't want a confirmation
--                                  email every time unless they opt in.
--   * digest_enabled            — schema-only placeholder for the upcoming
--                                  daily/weekly digest. No runtime wiring in
--                                  this pass — the column exists so the next
--                                  PR can land UI without another migration.
--
-- Defaults align with the existing philosophy: *opt-in* granular emails,
-- keeping the "least surprise" footprint. Existing columns
-- (email_on_complete, email_on_fail) are intentionally untouched; callers
-- that only know about the old shape keep working.
--
-- Rollback safety
-- ---------------
-- Drop the new columns in reverse order to safely revert:
--
--   ALTER TABLE public.operator_notification_preferences
--     DROP COLUMN IF EXISTS digest_enabled,
--     DROP COLUMN IF EXISTS email_on_cancel,
--     DROP COLUMN IF EXISTS email_on_approval_needed;
--
-- The ADD COLUMN statements use IF NOT EXISTS so re-running this migration
-- against a partially-applied DB is a no-op (Postgres 9.6+). RLS policies
-- from 20260420000003 continue to cover the new columns — they operate on
-- the row, not the column set, so no policy change is required.
-- =============================================================================

ALTER TABLE public.operator_notification_preferences
  ADD COLUMN IF NOT EXISTS email_on_approval_needed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_on_cancel          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS digest_enabled           boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.operator_notification_preferences.email_on_approval_needed IS
  'When true, emails the run owner once a plan-mode run reaches awaiting_approval.';
COMMENT ON COLUMN public.operator_notification_preferences.email_on_cancel IS
  'When true, emails the run owner once a run is cancelled (user-initiated).';
COMMENT ON COLUMN public.operator_notification_preferences.digest_enabled IS
  'Reserved for future daily/weekly digest wiring. Schema-only in this migration.';
