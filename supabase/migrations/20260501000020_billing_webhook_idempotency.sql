-- =============================================================================
-- Context Store — Creem billing webhook idempotency / replay protection
-- Migration: 20260501000020_billing_webhook_idempotency.sql
--
-- PROBLEM:
--   The Creem billing webhook (src/app/api/billing/webhook/route.ts) upserts
--   workspace_subscriptions on every signature-valid event. Creem retries on
--   failure and may redeliver old events, so a stale `subscription.canceled`
--   replayed after a renewal could clobber current plan/status back to
--   free/cancelled.
--
-- FIX:
--   Record every webhook event id the first time it is processed. The handler
--   attempts an INSERT of the event's `webhookId` at the top of each callback;
--   a unique-violation on the PRIMARY KEY means the event was already handled,
--   so the handler no-ops. The Creem adapter exposes a unique `webhookId` on
--   every flat callback payload, which is what we key on.
--
-- Creates:
--   Table: processed_webhook_events  (webhook_id PRIMARY KEY)
--   RLS:   ENABLED with NO policies — service-role / admin client only,
--          matching workspace_subscriptions' write contract.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
  webhook_id    text        PRIMARY KEY,
  event_type    text,
  processed_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
--   No policies: only the service-role (admin) client touches this table,
--   exactly like the writes to workspace_subscriptions. RLS is enabled so an
--   authenticated/anon client can never read or write it.
-- ---------------------------------------------------------------------------

ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;
