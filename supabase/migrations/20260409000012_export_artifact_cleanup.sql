-- =============================================================================
-- Context Store — export artifact cleanup helper
-- Migration: 20260409000012_export_artifact_cleanup.sql
--
-- Provides a helper function for manual or scheduled cleanup of accumulated
-- export artifacts in the private 'exports' Supabase Storage bucket.
--
-- Background:
--   The artifact delivery service now uses stable, resource-scoped storage
--   paths ({workspaceId}/{filename}) with upsert:true, so re-exporting the
--   same resource replaces the previous artifact. New artifacts no longer
--   accumulate indefinitely.
--
--   However, artifacts produced before this migration used timestamp-prefixed
--   paths ({workspaceId}/{timestamp}-{filename}) and may still be present.
--   This function handles bulk cleanup of those legacy artifacts, as well as
--   any future artifacts older than the retention threshold.
--
-- Usage (run from Supabase SQL editor or scheduled Edge Function):
--
--   -- Remove export artifacts older than 7 days
--   SELECT cleanup_old_export_artifacts(7);
--
--   -- Remove export artifacts older than 30 days
--   SELECT cleanup_old_export_artifacts(30);
--
-- Production recommendation:
--   Run weekly via a Supabase scheduled Edge Function or pg_cron job:
--     SELECT cron.schedule(
--       'cleanup-export-artifacts',
--       '0 3 * * 0',  -- Every Sunday at 03:00 UTC
--       $$SELECT cleanup_old_export_artifacts(7)$$
--     );
--
-- Note: This function requires pg_cron or manual invocation. It does NOT
--   run automatically on install. For private beta, manual cleanup is
--   sufficient given the single-owner workspace scope.
-- =============================================================================

CREATE OR REPLACE FUNCTION cleanup_old_export_artifacts(older_than_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Delete storage objects in the 'exports' bucket older than the threshold.
  -- The storage.objects table is managed by Supabase Storage.
  DELETE FROM storage.objects
  WHERE bucket_id = 'exports'
    AND created_at < now() - (older_than_days || ' days')::interval;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_old_export_artifacts(integer) IS
  'Remove export artifacts from the private exports bucket older than N days. '
  'Run manually or on a schedule (e.g. weekly via pg_cron). '
  'Returns the count of deleted objects.';
