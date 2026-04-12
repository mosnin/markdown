-- =============================================================================
-- Context Store — drag-and-drop persistence fix
-- Migration: 20260412000002_tree_ordering_fix.sql
--
-- Root cause we are fixing:
--   * workspace_objects.sort_order and box_object_attachments.sort_order were
--     declared as INTEGER (max 2_147_483_647). The server-action move code
--     writes sort_order = Date.now() (~1.7e12), which exceeds int4 and was
--     rejected by Postgres silently in the client path — so moves/reorders
--     never persisted.
--   * The original workspace_objects backfill
--     (20260411000003_workspace_objects_backfill.sql) only covered folders
--     and notes. Files, skills, agents created before the object-model
--     transition — and any leaf node that landed in the registry with the
--     default sort_order = 0 — had no durable structural position.
--
-- This migration:
--   1. Widens sort_order columns to bigint so Date.now()-style timestamps
--      fit without overflow.
--   2. Inserts missing workspace_objects rows for every active files/skills/
--      agents row that doesn't already have one.
--   3. Gives every row a distinct, monotonically-increasing sort_order based
--      on created_at (ms since epoch). Ties (same created_at) are broken by
--      id to guarantee determinism.
--
-- After this migration the tree has one canonical structural source of
-- truth (workspace_objects.sort_order for everything except the
-- box-level skill/agent attachments, which use
-- box_object_attachments.sort_order), every object has a distinct ordinal,
-- and the service / action layer can keep writing Date.now() without
-- overflow.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Widen sort_order columns to bigint
-- ---------------------------------------------------------------------------

ALTER TABLE public.workspace_objects
  ALTER COLUMN sort_order TYPE bigint USING sort_order::bigint;

ALTER TABLE public.box_object_attachments
  ALTER COLUMN sort_order TYPE bigint USING sort_order::bigint;

-- ---------------------------------------------------------------------------
-- 2. Backfill missing workspace_objects rows
--
--    Files, skills, and agents may exist without a registry row if they were
--    created before the registry expansion or if an earlier insert failed
--    softly. Insert a row for every active one that's missing.
-- ---------------------------------------------------------------------------

-- Files
INSERT INTO public.workspace_objects (
  workspace_id, box_id, folder_id, object_type, object_id,
  display_name, status, is_reusable
)
SELECT
  f.workspace_id, f.box_id, f.folder_id, 'file', f.id,
  f.name, f.status, false
FROM public.files f
WHERE NOT EXISTS (
  SELECT 1 FROM public.workspace_objects wo
  WHERE wo.object_type = 'file' AND wo.object_id = f.id
)
ON CONFLICT (object_type, object_id) DO NOTHING;

-- Skills (only box-local; reusable skills that live in many boxes are
-- represented via box_object_attachments, which was backfilled separately)
INSERT INTO public.workspace_objects (
  workspace_id, box_id, folder_id, object_type, object_id,
  display_name, status, is_reusable
)
SELECT
  s.workspace_id, s.box_id, s.folder_id, 'skill', s.id,
  s.name, s.status, s.is_reusable
FROM public.skills s
WHERE NOT EXISTS (
  SELECT 1 FROM public.workspace_objects wo
  WHERE wo.object_type = 'skill' AND wo.object_id = s.id
)
ON CONFLICT (object_type, object_id) DO NOTHING;

-- Agents
INSERT INTO public.workspace_objects (
  workspace_id, box_id, folder_id, object_type, object_id,
  display_name, status, is_reusable
)
SELECT
  a.workspace_id, a.box_id, a.folder_id, 'agent', a.id,
  a.name, a.status, a.is_reusable
FROM public.agents a
WHERE NOT EXISTS (
  SELECT 1 FROM public.workspace_objects wo
  WHERE wo.object_type = 'agent' AND wo.object_id = a.id
)
ON CONFLICT (object_type, object_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Give every workspace_objects row a distinct sort_order
--
--    Only update rows whose sort_order is still the default (0). Preserve
--    any sort_order the service layer may have already written.
--
--    The ordinal is derived from the underlying object's created_at so the
--    visible tree order mirrors creation order for legacy data. A per-(box,
--    folder_id) sequence is added on top so ties cannot collide.
-- ---------------------------------------------------------------------------

WITH all_objects AS (
  -- Join each workspace_objects row back to its core table to find created_at.
  SELECT wo.id AS wo_id, f.created_at AS created_at
  FROM public.workspace_objects wo
  JOIN public.folders f ON wo.object_type = 'folder' AND wo.object_id = f.id
  UNION ALL
  SELECT wo.id, n.created_at
  FROM public.workspace_objects wo
  JOIN public.notes n ON wo.object_type = 'note' AND wo.object_id = n.id
  UNION ALL
  SELECT wo.id, fi.created_at
  FROM public.workspace_objects wo
  JOIN public.files fi ON wo.object_type = 'file' AND wo.object_id = fi.id
  UNION ALL
  SELECT wo.id, s.created_at
  FROM public.workspace_objects wo
  JOIN public.skills s ON wo.object_type = 'skill' AND wo.object_id = s.id
  UNION ALL
  SELECT wo.id, a.created_at
  FROM public.workspace_objects wo
  JOIN public.agents a ON wo.object_type = 'agent' AND wo.object_id = a.id
),
ranked AS (
  SELECT
    ao.wo_id,
    -- Per-sibling-group rank. Multiply by 1000 so the service layer can
    -- later insert between neighbours by choosing a midpoint without
    -- colliding with existing ordinals.
    (ROW_NUMBER() OVER (
       PARTITION BY wo.box_id, wo.folder_id
       ORDER BY ao.created_at, wo.id
     )) * 1000 AS rank_bucket
  FROM all_objects ao
  JOIN public.workspace_objects wo ON wo.id = ao.wo_id
)
UPDATE public.workspace_objects wo
SET sort_order = r.rank_bucket
FROM ranked r
WHERE wo.id = r.wo_id
  AND wo.sort_order = 0;

-- Apply the same scheme to box_object_attachments so skill/agent
-- attachments inside a given (box, folder) have distinct gapped ordinals.
WITH ranked AS (
  SELECT
    boa.id AS att_id,
    (ROW_NUMBER() OVER (
       PARTITION BY boa.box_id, boa.folder_id
       ORDER BY boa.attached_at, boa.id
     )) * 1000 AS rank_bucket
  FROM public.box_object_attachments boa
)
UPDATE public.box_object_attachments boa
SET sort_order = r.rank_bucket
FROM ranked r
WHERE boa.id = r.att_id
  AND boa.sort_order = 0;
