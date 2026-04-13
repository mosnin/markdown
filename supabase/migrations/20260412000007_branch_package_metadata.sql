-- =============================================================================
-- Context Store — package-aware branch metadata overlay for Skills and Agents
-- Migration: 20260412000007_branch_package_metadata.sql
--
-- Up to now the branch model versioned exactly one field per
-- content-bearing object: note markdown, or the canonical `source_content`
-- on files / skills / agents. All other object fields (description,
-- tags, summary, agent_type, model_hint, system_prompt) stayed on main
-- and were ignored by the branch write path. That made Skills and
-- Agents — which are *package* objects — feel incoherent on a branch:
-- the user could edit the canonical source on a draft, but the
-- metadata describing the package stayed pinned to whatever main held.
--
-- This migration introduces `branch_package_metadata`, a thin overlay
-- table that records per-(branch, package) metadata overrides. On read,
-- skill_service / agent_service consult the overlay and patch the
-- returned row. On promote, `promoteBranch` applies the overlay to
-- the canonical skills / agents row as part of the existing
-- origin='branch_promotion' change set.
--
-- Design:
--
--   * One row per (branch_id, package_type, package_id). Upserted on
--     every metadata edit on a branch; no history per override (the
--     row is immutable from the branch's perspective — the branch is
--     either promoted or discarded).
--   * Fields stay wide-open nullable; the absence of a value means
--     "inherit from main", which keeps overlays as small as possible.
--   * `agent_type` / `model_hint` / `system_prompt` columns are
--     tolerated on skill rows too (stored-but-unused for skills) to
--     keep the table generic. The service layer enforces which fields
--     apply to which package_type.
-- =============================================================================

CREATE TABLE public.branch_package_metadata (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid        NOT NULL REFERENCES public.draft_branches(id) ON DELETE CASCADE,

  -- Restricted to the two package-style object types. Notes / files
  -- don't have package-level metadata — their full field set is
  -- already carried on their versioned rows.
  package_type    text        NOT NULL
                              CHECK (package_type IN ('skill', 'agent')),
  package_id      uuid        NOT NULL,

  -- Skill + agent shared overlay columns.
  description     text,
  tags            text[],
  summary         text,

  -- Agent-only overlay columns. Stored as null for skills.
  agent_type      text,
  model_hint      text,
  system_prompt   text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (branch_id, package_type, package_id)
);

CREATE INDEX branch_package_metadata_branch_idx
  ON public.branch_package_metadata (branch_id);
CREATE INDEX branch_package_metadata_package_idx
  ON public.branch_package_metadata (package_type, package_id);

CREATE TRIGGER branch_package_metadata_set_updated_at
  BEFORE UPDATE ON public.branch_package_metadata
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.branch_package_metadata ENABLE ROW LEVEL SECURITY;

-- Access rules match draft_branches: any workspace member can read
-- overlays on their workspace's branches; writes are gated to
-- write-capable roles at the service layer (the write-role RLS gate
-- added in 20260412000005 already applies via owns_workspace()
-- resolved through the branch's workspace_id).

CREATE POLICY branch_package_metadata_access
  ON public.branch_package_metadata
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = branch_package_metadata.branch_id
        AND public.owns_workspace(b.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = branch_package_metadata.branch_id
        AND public.can_write_workspace(b.workspace_id)
    )
  );
