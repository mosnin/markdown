-- =============================================================================
-- Workspace Operator saved prompts — explicit ordering.
-- Migration: 20260420000007_operator_prompts_ordering.sql
--
-- Closes Operator Gap #9: users couldn't reorder their saved prompts. Until
-- now the `workspace_operator_prompts` list rendered newest-updated-first,
-- so any edit shuffled the order. A dedicated integer `sort_order` column
-- lets the management UI swap adjacent rows (Up / Down buttons) without
-- touching updated_at.
--
-- Ordering policy (matched by listOperatorPrompts in the service):
--   ORDER BY sort_order ASC, updated_at DESC
-- The updated_at tiebreak keeps legacy behaviour for rows sharing a
-- sort_order (e.g. during the brief window of a swap, or for never-moved
-- prompts that all default to 0 before the seed).
--
-- Seed logic: every existing row is assigned a unique sort_order per
-- (workspace_id, user_id) partition, ordered by the historical
-- updated_at DESC so the first render after the migration matches the
-- pre-migration list.
-- =============================================================================

ALTER TABLE public.workspace_operator_prompts
  ADD COLUMN sort_order integer NOT NULL DEFAULT 0;

-- One-time seed: give each row an initial sort_order so the migrated UI
-- has a stable ordering to work with. row_number() starts at 1; zeros are
-- reserved implicitly for the DEFAULT (never actually hit after the UPDATE
-- below runs because every existing row is rewritten).
WITH ordered AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY workspace_id, user_id
      ORDER BY updated_at DESC
    ) AS rn
  FROM public.workspace_operator_prompts
)
UPDATE public.workspace_operator_prompts p
SET sort_order = ordered.rn
FROM ordered
WHERE p.id = ordered.id;

-- Lookup / sort index. Paired with the existing
-- workspace_operator_prompts_user_idx (which uses updated_at DESC for the
-- tiebreak) this covers the common list query end-to-end.
CREATE INDEX workspace_operator_prompts_order_idx
  ON public.workspace_operator_prompts (workspace_id, user_id, sort_order);
