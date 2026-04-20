-- =============================================================================
-- Workspace Operator runs — real cancellation + per-run token budget (Wave 1 F)
-- Migration: 20260420000001_operator_cancel_and_budget.sql
--
-- Adds three columns to workspace_operator_runs:
--
--   * cancellation_requested_at  — set by the UI's Cancel action via the
--     `cancelOperatorRun` service helper. The Modal Python operator polls a
--     small endpoint (GET /api/agent/operator/check_cancel) between phases
--     and aborts when this flips from NULL to a timestamp.
--   * max_input_tokens / max_output_tokens — optional per-run budget caps.
--     NULL means "no cap" (current behaviour). When set, the operator
--     short-circuits the run after a step's usage report exceeds either cap
--     and returns whatever artifacts it had already drafted.
--
-- Backfill is trivial: existing rows get NULL on every new column, which is
-- the no-op default.
-- =============================================================================

alter table public.workspace_operator_runs
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists max_input_tokens          integer,
  add column if not exists max_output_tokens         integer;

-- Cheap partial index to power "is this run cancelled?" lookups (the operator
-- polls this column once per phase; we want the answer in <1ms even when the
-- table has hundreds of thousands of historical rows).
create index if not exists workspace_operator_runs_cancel_idx
  on public.workspace_operator_runs (id)
  where cancellation_requested_at is not null;

-- Sanity check: budget caps must be positive when present. NULL is allowed
-- (and is the "no cap" sentinel).
alter table public.workspace_operator_runs
  add constraint workspace_operator_runs_max_input_tokens_positive
    check (max_input_tokens is null or max_input_tokens > 0);

alter table public.workspace_operator_runs
  add constraint workspace_operator_runs_max_output_tokens_positive
    check (max_output_tokens is null or max_output_tokens > 0);
