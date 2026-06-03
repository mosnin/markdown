-- =============================================================================
-- Context Store — v3 critical security & partition fixes
-- Migration: 20260421000001_v3_critical_security_and_partition_fixes.sql
--
-- Fixes three issues surfaced by v3 post-launch audit:
--
--   BUG 1 (CRITICAL SECURITY): public.webauthn_credentials and
--     public.webauthn_challenges (created in 20260414000010) were shipped
--     with NO row-level security. Any authenticated user could potentially
--     read another user's passkey public-key material or challenge nonces.
--     This migration enables RLS and installs owner-scoped policies on
--     both tables. Credentials are immutable from the client — counters
--     are bumped via service-role RPC — so no UPDATE policy is added.
--
--   BUG 2 (CRITICAL OPERATIONAL): audit_events is range-partitioned
--     monthly, but the last manually created partition only covers
--     July 2026 (see 20260414000009_partition_append_only_tables.sql).
--     On 2026-08-01, all audit INSERTs would fail with "no partition
--     of relation" — breaking every write path in the app. The helper
--     public.create_future_audit_partitions(months_ahead) was added in
--     20260414000011_auto_partition_maintenance.sql; this migration
--     reuses it (seeds 6 months ahead) and schedules it via pg_cron so
--     partitions are topped up daily going forward. If pg_cron is not
--     available on the target instance, see the fallback comment block
--     near the bottom of this file.
--
--   BUG 3 (MEDIUM): verified that 20260415000011_v3_rls_hardening.sql
--     already installs RLS + policies for link_suggestions and
--     note_templates. No-op here — kept only as a documentation anchor.
--
-- Conventions:
--   * Idempotent: DROP POLICY IF EXISTS / CREATE POLICY pattern
--     (matches 20260415000012_v3_deep_audit_fixes.sql).
--   * ENABLE ROW LEVEL SECURITY is safe to re-run.
--   * Wrapped in a single transaction.
-- =============================================================================

BEGIN;

-- =========================================================================
-- BUG 1: RLS for webauthn_credentials and webauthn_challenges
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1a. webauthn_credentials — user-scoped, immutable from the client.
-- -------------------------------------------------------------------------

ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;

-- SELECT: a user can only see their own credentials.
DROP POLICY IF EXISTS webauthn_credentials_select ON public.webauthn_credentials;
CREATE POLICY webauthn_credentials_select
  ON public.webauthn_credentials FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- INSERT: a user can only register credentials for themselves.
DROP POLICY IF EXISTS webauthn_credentials_insert ON public.webauthn_credentials;
CREATE POLICY webauthn_credentials_insert
  ON public.webauthn_credentials FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- DELETE: a user can remove their own credentials (e.g. from settings UI).
DROP POLICY IF EXISTS webauthn_credentials_delete ON public.webauthn_credentials;
CREATE POLICY webauthn_credentials_delete
  ON public.webauthn_credentials FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- No UPDATE policy on purpose. Credentials are immutable from the client;
-- the signature counter is bumped by a service-role RPC which bypasses RLS.

-- -------------------------------------------------------------------------
-- 1b. webauthn_challenges — ephemeral, but enforce user scope in depth.
-- -------------------------------------------------------------------------

ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;

-- SELECT: a user can only see their own challenges. Registration flows
-- allow user_id IS NULL (pre-signup) — those rows are service-role only.
DROP POLICY IF EXISTS webauthn_challenges_select ON public.webauthn_challenges;
CREATE POLICY webauthn_challenges_select
  ON public.webauthn_challenges FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS webauthn_challenges_insert ON public.webauthn_challenges;
CREATE POLICY webauthn_challenges_insert
  ON public.webauthn_challenges FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS webauthn_challenges_delete ON public.webauthn_challenges;
CREATE POLICY webauthn_challenges_delete
  ON public.webauthn_challenges FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- No UPDATE policy. Challenges are write-once / delete-on-consume.

-- =========================================================================
-- BUG 2: seed and schedule audit_events partition maintenance
-- =========================================================================

-- The helper public.create_future_audit_partitions(months_ahead int) was
-- introduced in 20260414000011_auto_partition_maintenance.sql. It uses the
-- audit_events_YYYY_MM naming scheme. The original partitions from
-- 20260414000009 used audit_events_y2026mMM, but 20260414000011 already
-- renames them to the new scheme, so CREATE TABLE IF NOT EXISTS is safe.

-- 2a. Seed the next 6 months of partitions immediately. From 2026-04 this
--     covers Apr 2026 through Oct 2026 inclusive. Safe to re-run.
SELECT public.create_future_audit_partitions(6);

-- 2b. Schedule daily partition top-up via pg_cron so we never again ship a
--     release that runs out of partitions. Each run is a no-op once the
--     next 3 months are already present.
--
--     pg_cron is available on hosted Supabase via the Extensions page;
--     CREATE EXTENSION is idempotent.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove any prior schedule with the same name so this migration is
-- idempotent when re-run (cron.unschedule raises if the job is missing,
-- so use the safe form).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    -- cron.job lives in the cron schema once the extension is installed.
    IF EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'create_future_audit_partitions'
    ) THEN
      PERFORM cron.unschedule('create_future_audit_partitions');
    END IF;

    PERFORM cron.schedule(
      'create_future_audit_partitions',
      '0 2 * * *',  -- daily at 02:00 UTC
      $cron$SELECT public.create_future_audit_partitions(3)$cron$
    );
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- Fallback if pg_cron is NOT available on the target instance
-- -------------------------------------------------------------------------
-- If the CREATE EXTENSION above fails (e.g. on a self-hosted Postgres
-- without pg_cron compiled in), comment it out and schedule the call
-- externally. Options:
--
--   1. Supabase scheduled Edge Function (cron expression in config.toml)
--      invoking an internal endpoint that runs:
--
--        SELECT public.create_future_audit_partitions(3);
--
--   2. External cron hitting POST /api/internal/partition_maintenance
--      (must carry the service-role bearer token). The route should call
--      the same RPC via the service-role Supabase client. Recommended
--      cadence: daily at 02:00 UTC.
--
--   3. Manual quarterly migration that simply runs the SELECT above.
-- -------------------------------------------------------------------------

-- =========================================================================
-- BUG 3: link_suggestions + note_templates RLS verification
-- =========================================================================
--
-- Verified 2026-04-21: both tables already have RLS enabled with the
-- appropriate policies, installed by 20260415000011_v3_rls_hardening.sql:
--
--   * link_suggestions  — policies link_suggestions_{select,insert,update,delete}
--   * note_templates    — policies note_templates_{select,insert,update,delete}
--
-- No additional action required here. Left as an anchor so future auditors
-- can grep for the verification date.

COMMIT;
