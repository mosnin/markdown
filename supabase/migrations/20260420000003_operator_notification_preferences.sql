-- =============================================================================
-- Operator notification preferences — per-user opt-in for run completion
-- and run failure email notifications.
-- Migration: 20260420000003_operator_notification_preferences.sql
--
-- Modeled after public.user_agent_preferences (20260419000002): one row per
-- user, strict self-only RLS. Defaults reflect the principle of least
-- surprise — a user gets emailed when something *goes wrong* with a run
-- they kicked off (failures default ON), but does NOT get emailed for the
-- happy path unless they opt in (completions default OFF).
--
-- The notifications service (operator_notifications_service.ts) reads
-- this table and either sends via Resend (if RESEND_API_KEY is set) or
-- logs the intended notification.
-- =============================================================================

CREATE TABLE public.operator_notification_preferences (
  user_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_on_complete  boolean NOT NULL DEFAULT false,
  email_on_fail      boolean NOT NULL DEFAULT true,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER operator_notification_preferences_set_updated_at
  BEFORE UPDATE ON public.operator_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.operator_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY operator_notification_preferences_self_select
  ON public.operator_notification_preferences
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY operator_notification_preferences_self_insert
  ON public.operator_notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY operator_notification_preferences_self_update
  ON public.operator_notification_preferences
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY operator_notification_preferences_self_delete
  ON public.operator_notification_preferences
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
