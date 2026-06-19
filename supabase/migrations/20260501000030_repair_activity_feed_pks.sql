-- Migration: 20260501000030_repair_activity_feed_pks.sql
--
-- Repair for the activity-feed primary keys.
--
-- 20260415000006 created `user_notification_preferences` and
-- `user_feed_read_cursors` with PRIMARY KEY (user_id). That migration was later
-- corrected in place to the intended composite PRIMARY KEY (user_id,
-- workspace_id) — correct for fresh databases, but databases that had already
-- applied the original version keep the single-column PK, because a migration
-- version never re-runs. That single-column PK lets a user hold only one row
-- total, so writing prefs/cursors for a *second* workspace fails.
--
-- This forward migration repairs an already-migrated database. It is
-- idempotent: it only acts when the current primary key is still a single
-- column, so it is a no-op on fresh databases created from the corrected
-- 20260415000006.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = to_regclass('public.user_notification_preferences')
      AND i.indisprimary
      AND i.indnkeyatts = 1
  ) THEN
    ALTER TABLE public.user_notification_preferences
      DROP CONSTRAINT IF EXISTS user_notification_preferences_pkey;
    ALTER TABLE public.user_notification_preferences
      DROP CONSTRAINT IF EXISTS user_notification_preferences_user_id_workspace_id_key;
    ALTER TABLE public.user_notification_preferences
      ADD PRIMARY KEY (user_id, workspace_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = to_regclass('public.user_feed_read_cursors')
      AND i.indisprimary
      AND i.indnkeyatts = 1
  ) THEN
    ALTER TABLE public.user_feed_read_cursors
      DROP CONSTRAINT IF EXISTS user_feed_read_cursors_pkey;
    ALTER TABLE public.user_feed_read_cursors
      DROP CONSTRAINT IF EXISTS user_feed_read_cursors_user_id_workspace_id_key;
    ALTER TABLE public.user_feed_read_cursors
      ADD PRIMARY KEY (user_id, workspace_id);
  END IF;
END $$;
