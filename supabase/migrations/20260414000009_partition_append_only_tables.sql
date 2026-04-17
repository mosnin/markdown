-- =============================================================================
-- Context Store — partition audit_events + index note_versions
-- Migration: 20260414000009_partition_append_only_tables.sql
--
-- audit_events is append-only and grows unbounded. This migration converts
-- it to range-partitioned by created_at (monthly) using the rename-swap
-- pattern because Postgres does not support ALTER TABLE ... PARTITION BY.
--
-- note_versions is also append-only but has self-referencing FK constraints
-- and is referenced by notes.current_version_id and write_proposals. Those
-- FK references make partitioning impractical in Postgres. Instead we add
-- a partial index for the most common query pattern (latest version lookup)
-- since the table is unlikely to exceed 1M rows in the near term.
--
-- NOTE: New audit_events partitions must be created monthly. Use a
-- scheduled job (pg_cron) or a migration before each quarter to create
-- upcoming partitions. If a row is inserted with a created_at that has
-- no matching partition, the INSERT will fail.
-- =============================================================================

BEGIN;

-- =========================================================================
-- PART 1: audit_events → range-partitioned by created_at (monthly)
-- =========================================================================

-- ---------------------------------------------------------------------------
-- 1a. Create the new partitioned table with the same column definitions.
--     The column order and constraints match the original table plus the
--     change_set_id column added by 20260412000004.
--
--     For partitioned tables, the PRIMARY KEY must include the partition
--     key (created_at). We use (id, created_at) as the PK.
-- ---------------------------------------------------------------------------

CREATE TABLE public.audit_events_partitioned (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  actor_type   text        NOT NULL CHECK (actor_type IN ('user', 'connection', 'system')),
  actor_id     text        NOT NULL,
  object_type  text        NOT NULL CHECK (char_length(object_type) > 0),
  object_id    text        NOT NULL,
  event_type   text        NOT NULL CHECK (char_length(event_type) > 0),
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  change_set_id uuid       REFERENCES public.change_sets(id) ON DELETE SET NULL,

  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- ---------------------------------------------------------------------------
-- 1b. Create partitions: a default for historical data, current month
--     (April 2026), and the next 3 months (May–July 2026).
-- ---------------------------------------------------------------------------

-- Default partition catches all rows that don't match an explicit range,
-- including all historical data migrated from the legacy table.
CREATE TABLE public.audit_events_default
  PARTITION OF public.audit_events_partitioned DEFAULT;

CREATE TABLE public.audit_events_y2026m04
  PARTITION OF public.audit_events_partitioned
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE public.audit_events_y2026m05
  PARTITION OF public.audit_events_partitioned
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE public.audit_events_y2026m06
  PARTITION OF public.audit_events_partitioned
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE public.audit_events_y2026m07
  PARTITION OF public.audit_events_partitioned
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- ---------------------------------------------------------------------------
-- 1c. Copy existing data from the original table into the partitioned one.
-- ---------------------------------------------------------------------------

INSERT INTO public.audit_events_partitioned
  (id, workspace_id, actor_type, actor_id, object_type, object_id,
   event_type, metadata, created_at, change_set_id)
SELECT
  id, workspace_id, actor_type, actor_id, object_type, object_id,
  event_type, metadata, created_at, change_set_id
FROM public.audit_events;

-- ---------------------------------------------------------------------------
-- 1d. Drop RLS policies on the old table before renaming.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "audit_events_workspace_select" ON public.audit_events;
DROP POLICY IF EXISTS "audit_events_workspace_insert" ON public.audit_events;

-- ---------------------------------------------------------------------------
-- 1e. Swap tables: old → legacy, partitioned → audit_events.
-- ---------------------------------------------------------------------------

ALTER TABLE public.audit_events RENAME TO audit_events_legacy;
ALTER TABLE public.audit_events_partitioned RENAME TO audit_events;

-- Also rename partitions to follow the parent name consistently.
-- (Partition names remain as-is; they are referenced internally.)

-- ---------------------------------------------------------------------------
-- 1f. Recreate indexes on the new partitioned table.
--     Postgres propagates indexes on partitioned tables to each partition.
-- ---------------------------------------------------------------------------

CREATE INDEX audit_events_workspace_id_created_at_idx
  ON public.audit_events (workspace_id, created_at DESC);

CREATE INDEX audit_events_object_idx
  ON public.audit_events (workspace_id, object_type, object_id);

CREATE INDEX audit_events_actor_idx
  ON public.audit_events (workspace_id, actor_type, actor_id);

CREATE INDEX audit_events_change_set_id_idx
  ON public.audit_events (change_set_id)
  WHERE change_set_id IS NOT NULL;

-- Additional index: created_at range scans (e.g. "events in last 24 hours")
CREATE INDEX audit_events_created_at_idx
  ON public.audit_events (created_at DESC);

-- ---------------------------------------------------------------------------
-- 1g. Enable RLS and recreate policies on the new table.
-- ---------------------------------------------------------------------------

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_events_workspace_select"
  ON public.audit_events FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY "audit_events_workspace_insert"
  ON public.audit_events FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

-- No UPDATE or DELETE — audit events are immutable.

-- ---------------------------------------------------------------------------
-- 1h. Add a comment documenting the partition maintenance requirement.
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.audit_events IS
  'Append-only workspace-scoped event log. Range-partitioned by created_at '
  '(monthly). New partitions MUST be created before each month begins — use '
  'pg_cron or a quarterly migration. Example: CREATE TABLE '
  'audit_events_y2026m08 PARTITION OF audit_events FOR VALUES FROM '
  '(''2026-08-01'') TO (''2026-09-01'');';

-- =========================================================================
-- PART 2: note_versions — add query-optimized indexes (no partitioning)
--
-- Partitioning skipped because:
--   1. Self-referencing FK (parent_version_id → note_versions.id)
--   2. Referenced by notes.current_version_id and
--      write_proposals.target_version_id / approved_version_id
--   3. Row count is expected to stay under 1M in the near term
--
-- The (note_id, created_at DESC) index already exists from core_schema.
-- We add a complementary index for version-number-based lookups.
-- =========================================================================

-- Latest-version-number lookup: many RPCs do
--   SELECT MAX(version_number) FROM note_versions WHERE note_id = $1
-- or ORDER BY version_number DESC LIMIT 1.
CREATE INDEX IF NOT EXISTS note_versions_note_id_version_number_desc_idx
  ON public.note_versions (note_id, version_number DESC);

-- Actor-based audit queries on note_versions (who edited what).
CREATE INDEX IF NOT EXISTS note_versions_actor_idx
  ON public.note_versions (actor_type, actor_id);

COMMIT;
