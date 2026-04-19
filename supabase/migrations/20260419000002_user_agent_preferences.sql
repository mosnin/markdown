-- =============================================================================
-- Per-user agent preferences — tone, citation style, tool allowlist, …
-- Migration: 20260419000002_user_agent_preferences.sql
--
-- One row per user. Lives outside auth.users.user_metadata so we can
-- query it from server actions (e.g. when assembling the system prompt
-- for the Workspace Operator) without forcing a JWT refresh, and so we
-- can constrain it with CHECK constraints rather than trusting whatever
-- shape the client wrote into metadata.
--
-- Modeled after public.user_notification_preferences
-- (20260415000006_activity_feed.sql) — same self-only RLS pattern.
-- =============================================================================

CREATE TABLE public.user_agent_preferences (
  user_id              uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tone                 text        NOT NULL DEFAULT 'neutral'
                                   CHECK (tone IN ('neutral', 'formal', 'casual', 'technical', 'friendly')),
  citation_style       text        NOT NULL DEFAULT 'inline'
                                   CHECK (citation_style IN ('inline', 'footnote', 'endnote')),
  tool_allowlist       text[]      NOT NULL DEFAULT ARRAY[
                                     'hybrid_search',
                                     'draft_note',
                                     'read_note',
                                     'edit_note',
                                     'link_notes',
                                     'apply_template',
                                     'web_fetch'
                                   ]::text[],
  must_cite_per_claim  boolean     NOT NULL DEFAULT false,
  max_tool_calls       integer     NOT NULL DEFAULT 20
                                   CHECK (max_tool_calls BETWEEN 1 AND 100),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER user_agent_preferences_set_updated_at
  BEFORE UPDATE ON public.user_agent_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — strictly per-user. The user can read/write only their own row.
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_agent_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_agent_preferences_self_select
  ON public.user_agent_preferences
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY user_agent_preferences_self_insert
  ON public.user_agent_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_agent_preferences_self_update
  ON public.user_agent_preferences
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_agent_preferences_self_delete
  ON public.user_agent_preferences
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
