-- =============================================================================
-- Context Store — automatic audit partition maintenance
-- Migration: 20260414000011_auto_partition_maintenance.sql
--
-- Creates a PL/pgSQL function that automatically creates future monthly
-- partitions for the audit_events table. This avoids INSERT failures when
-- a new month begins without a partition in place.
--
-- The function should be called monthly via pg_cron or an external cron
-- job to ensure partitions always exist ahead of time.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- create_future_audit_partitions(months_ahead integer DEFAULT 3)
--
-- For each month from the current month through current month + months_ahead,
-- checks if a partition already exists and creates it if not.
--
-- Naming convention: audit_events_YYYY_MM
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_future_audit_partitions(
  months_ahead integer DEFAULT 3
)
RETURNS text[] AS $$
DECLARE
  i integer;
  target_date date;
  partition_name text;
  range_start text;
  range_end text;
  created text[] := '{}';
BEGIN
  FOR i IN 0..months_ahead LOOP
    target_date := date_trunc('month', current_date)::date + (i || ' months')::interval;
    partition_name := 'audit_events_' || to_char(target_date, 'YYYY_MM');
    range_start := to_char(target_date, 'YYYY-MM-DD');
    range_end := to_char(target_date + interval '1 month', 'YYYY-MM-DD');

    -- Only create if the partition does not already exist
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = partition_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.audit_events FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        range_start,
        range_end
      );
      created := array_append(created, partition_name);
    END IF;
  END LOOP;

  RETURN created;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.create_future_audit_partitions IS 'Call monthly via pg_cron or external cron to ensure future partitions exist. Usage: SELECT create_future_audit_partitions(3);';

-- ---------------------------------------------------------------------------
-- Run once now to ensure partitions exist through October 2026.
-- Current month is April 2026, so months_ahead=6 covers Apr–Oct.
-- ---------------------------------------------------------------------------

SELECT public.create_future_audit_partitions(6);

COMMIT;
