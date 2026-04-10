-- =============================================================================
-- Context Store — workspace subscriptions
-- Migration: 20260409000013_workspace_subscriptions.sql
--
-- Creates:
--   Table: workspace_subscriptions
--   RLS policies: workspace owner can read their own subscription
--   Indexes: workspace_id, creem_subscription_id
-- =============================================================================

CREATE TABLE public.workspace_subscriptions (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  creem_customer_id       text,
  creem_subscription_id   text,
  plan                    text        NOT NULL DEFAULT 'free'
                                      CHECK (plan IN ('free', 'pro')),
  status                  text        NOT NULL DEFAULT 'active'
                                      CHECK (status IN ('active', 'cancelled', 'past_due')),
  current_period_end      timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (workspace_id)
);

-- ---------------------------------------------------------------------------
-- Trigger: keep updated_at current
-- ---------------------------------------------------------------------------

CREATE TRIGGER workspace_subscriptions_set_updated_at
  BEFORE UPDATE ON public.workspace_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_workspace_subscriptions_workspace_id
  ON public.workspace_subscriptions (workspace_id);

CREATE INDEX idx_workspace_subscriptions_creem_subscription_id
  ON public.workspace_subscriptions (creem_subscription_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
--   Workspace owner can read their own subscription record.
--   Writes are performed via service-role client (webhook handler / API).
-- ---------------------------------------------------------------------------

ALTER TABLE public.workspace_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_subscriptions_owner_select"
  ON public.workspace_subscriptions FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));
