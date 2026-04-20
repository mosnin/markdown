-- =============================================================================
-- Workspace Operator runs — per-run token usage columns (Phase 4)
-- Migration: 20260419000005_operator_run_token_counts.sql
--
-- Phase 4 captures LLM token usage on every Workspace Operator run so the UI
-- history view can show cost, and so the billing / quota table
-- (workspace_operator_usage, added by Agent A in a separate migration) can
-- aggregate from a consistent source. `cached_input_tokens` is the portion
-- of `input_tokens` that OpenAI's auto-cache served at the discounted rate
-- — tracking it separately lets us monitor cache-hit rate over time.
-- =============================================================================

alter table public.workspace_operator_runs
  add column if not exists input_tokens        integer NOT NULL DEFAULT 0,
  add column if not exists output_tokens       integer NOT NULL DEFAULT 0,
  add column if not exists cached_input_tokens integer NOT NULL DEFAULT 0,
  add column if not exists model               text;

-- Light index for cost-dashboard queries that sum tokens per workspace by day.
create index if not exists workspace_operator_runs_tokens_idx
  on public.workspace_operator_runs (workspace_id, created_at desc)
  where input_tokens > 0;
