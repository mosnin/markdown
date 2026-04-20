-- =============================================================================
-- Business tier + per-workspace operator-quota override flag.
-- Migration: 20260419000004_business_tier.sql
--
-- Phase 4 of the Workspace Operator introduces a third plan tier
-- (`business`) and a per-tier monthly quota on Operator runs. Two schema
-- shifts are needed:
--
--   1. Relax the workspace_subscriptions.plan CHECK constraint so the
--      value `business` is allowed alongside `free` and `pro`.
--   2. Add a boolean column `override_operator_quota` so admins can
--      exempt a specific workspace from the Operator monthly cap
--      without upgrading their plan. This is intentionally distinct
--      from `manually_overridden`, which only prevents Creem webhook
--      syncs from clobbering the plan — that flag does NOT affect
--      quota enforcement.
-- =============================================================================

-- ── 1. Allow a third tier value ─────────────────────────────────────────────

alter table public.workspace_subscriptions
  drop constraint if exists workspace_subscriptions_plan_check;

alter table public.workspace_subscriptions
  add constraint workspace_subscriptions_plan_check
  check (plan in ('free', 'pro', 'business'));

-- ── 2. Per-workspace Operator quota override ─────────────────────────────────

alter table public.workspace_subscriptions
  add column override_operator_quota boolean not null default false;

comment on column public.workspace_subscriptions.override_operator_quota is
  'Admin escape hatch: when true, checkOperatorQuota() always returns allowed=true for this workspace. Independent of manually_overridden (which only gates Creem sync).';
