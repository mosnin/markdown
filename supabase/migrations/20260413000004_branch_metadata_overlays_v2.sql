-- =============================================================================
-- Context Store — branch metadata overlays v2
-- Migration: 20260413000004_branch_metadata_overlays_v2.sql
--
-- Two closely-related additions land in one migration:
--
--   1. `branch_package_metadata.name` — Skills and Agents already
--      overlay description/tags/summary on a branch, but *renames*
--      still mutated `skills.name` and `workspace_objects.display_name`
--      directly. That leaked the draft name into every main read. We
--      add `name` as an additional nullable overlay column; null
--      means "inherit from main". Promote patches both `skills.name`
--      and the denormalized `workspace_objects.display_name`.
--
--   2. `box_branch_metadata_overlay` — boxes needed the same thing
--      for name / description updates. Rather than bolting boxes
--      onto `branch_package_metadata` (whose shape is skill/agent-
--      specific — the `package_type` CHECK, the agent-only columns)
--      we stand up a narrow, single-purpose overlay table. Smaller
--      blast radius, easier to evolve. See the v1.9 design note in
--      `docs/branch_local_structural_creation_v1.md`.
--
-- Both overlays compose with the existing `branch_id` column on
-- `boxes` / `skills` / `agents` — a branch-created box keeps writing
-- its fields directly because the whole row belongs to the branch.
-- Only branch intents against main rows go through the overlay.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. branch_package_metadata.name
--
--    Nullable so absence means "no override". Explicit non-null
--    overlays the canonical name on branch-aware reads.
--    skill_service + agent_service already apply the overlay through
--    `applyPackageMetadataOverlay`; the service layer is extended to
--    accept `name` alongside description / tags / summary.
-- ---------------------------------------------------------------------------

ALTER TABLE public.branch_package_metadata
  ADD COLUMN name text;

-- ---------------------------------------------------------------------------
-- 2. box_branch_metadata_overlay
--
--    Shape mirrors branch_package_metadata: one row per
--    (branch_id, box_id); nullable columns so absent = inherit.
--    Promote patches the canonical boxes row; discard hard-deletes
--    the overlay (the branch intent never reached main).
-- ---------------------------------------------------------------------------

CREATE TABLE public.box_branch_metadata_overlay (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid        NOT NULL REFERENCES public.draft_branches(id) ON DELETE CASCADE,
  box_id          uuid        NOT NULL REFERENCES public.boxes(id) ON DELETE CASCADE,

  name            text,
  description     text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (branch_id, box_id)
);

CREATE INDEX box_branch_metadata_overlay_branch_idx
  ON public.box_branch_metadata_overlay (branch_id);
CREATE INDEX box_branch_metadata_overlay_box_idx
  ON public.box_branch_metadata_overlay (box_id);

CREATE TRIGGER box_branch_metadata_overlay_set_updated_at
  BEFORE UPDATE ON public.box_branch_metadata_overlay
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.box_branch_metadata_overlay ENABLE ROW LEVEL SECURITY;

-- Access rules match branch_package_metadata: any workspace member
-- can read overlays on their workspace's branches; writes are gated
-- to write-capable roles.

CREATE POLICY box_branch_metadata_overlay_access
  ON public.box_branch_metadata_overlay
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = box_branch_metadata_overlay.branch_id
        AND public.owns_workspace(b.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = box_branch_metadata_overlay.branch_id
        AND public.can_write_workspace(b.workspace_id)
    )
  );
