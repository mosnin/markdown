-- Migration: 20260415000006_activity_feed.sql
-- Feature: Activity feed & change notifications
--
-- Two new tables:
--   1. user_notification_preferences — per-user, per-workspace toggles
--      for which event categories appear in the activity feed.
--   2. user_feed_read_cursors — tracks the last-read timestamp so the
--      client can compute an unread badge count.

-- ─── 1. Notification preferences ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  note_created  boolean     NOT NULL DEFAULT true,
  note_updated  boolean     NOT NULL DEFAULT false,
  link_created  boolean     NOT NULL DEFAULT true,
  branch_promoted boolean   NOT NULL DEFAULT true,
  member_joined boolean     NOT NULL DEFAULT true,
  proposal_submitted boolean NOT NULL DEFAULT true,
  email_digest  text        NOT NULL DEFAULT 'none'
    CHECK (email_digest IN ('none', 'daily', 'weekly')),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id),
  UNIQUE (user_id, workspace_id)
);

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_notification_preferences_self_select
  ON public.user_notification_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY user_notification_preferences_self_insert
  ON public.user_notification_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_notification_preferences_self_update
  ON public.user_notification_preferences FOR UPDATE
  USING (auth.uid() = user_id);

-- ─── 2. Feed read cursors ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_feed_read_cursors (
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  last_read_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id),
  UNIQUE (user_id, workspace_id)
);

ALTER TABLE public.user_feed_read_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_feed_read_cursors_self_select
  ON public.user_feed_read_cursors FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY user_feed_read_cursors_self_insert
  ON public.user_feed_read_cursors FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_feed_read_cursors_self_update
  ON public.user_feed_read_cursors FOR UPDATE
  USING (auth.uid() = user_id);
