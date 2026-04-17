-- =============================================================================
-- Branch review workflow — schema
-- Migration: 20260414000003_branch_reviews.sql
--
-- Adds the lightweight review gate + per-diff-row comment threads that
-- sit in front of `promoteBranch`. Three moving parts:
--
--   1. `draft_branches.review_status` — single-source-of-truth gate
--      read by `promoteBranch` to decide whether a branch can land.
--      'draft' is the legacy "author going solo" path; 'approved'
--      explicitly passes; 'review_requested' and 'changes_requested'
--      block promote.
--
--   2. `branch_reviews` — one row per submitted review. Rows are
--      append-only from the user's perspective: a later review from
--      the same reviewer stamps `superseded_at` on their earlier row
--      rather than mutating it, so the history of decisions on a
--      branch survives for audit.
--
--   3. `branch_comments` — per-diff-row threaded comment storage.
--      `object_type` / `object_id` addresses whatever diff row the
--      comment is anchored to (note / file / skill / agent / folder /
--      …) and `parent_comment_id` threads replies.
--
-- RLS: same workspace-member pattern as `folder_branch_overrides` —
-- read for workspace owners, write gated via `can_write_workspace`
-- resolved through the branch's workspace_id. Comments' "author can
-- always edit / delete their own" is enforced at the service layer
-- on top of the workspace-membership SELECT guard.
-- =============================================================================

-- Review state on the branch itself (single source of truth for gating).
ALTER TABLE public.draft_branches
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'draft'
    CHECK (review_status IN ('draft', 'review_requested', 'approved', 'changes_requested'));

-- Individual review records (who approved, who requested changes, when).
CREATE TABLE IF NOT EXISTS public.branch_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES public.draft_branches(id) ON DELETE CASCADE,
  reviewer_id     uuid NOT NULL REFERENCES auth.users(id),
  decision        text NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  superseded_at   timestamptz,  -- non-null when a later review from same reviewer replaces this one
  UNIQUE (branch_id, reviewer_id, created_at)
);
CREATE INDEX IF NOT EXISTS branch_reviews_branch_idx
  ON public.branch_reviews (branch_id) WHERE superseded_at IS NULL;

-- Per-diff-row comments (threaded).
CREATE TABLE IF NOT EXISTS public.branch_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         uuid NOT NULL REFERENCES public.draft_branches(id) ON DELETE CASCADE,
  object_type       text NOT NULL,
  object_id         uuid NOT NULL,
  parent_comment_id uuid REFERENCES public.branch_comments(id) ON DELETE CASCADE,
  author_id         uuid NOT NULL REFERENCES auth.users(id),
  body              text NOT NULL,
  resolved          boolean NOT NULL DEFAULT false,
  resolved_by       uuid REFERENCES auth.users(id),
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS branch_comments_branch_object_idx
  ON public.branch_comments (branch_id, object_type, object_id);

CREATE TRIGGER branch_comments_set_updated_at
  BEFORE UPDATE ON public.branch_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS — same workspace-member pattern as `folder_branch_overrides`.

ALTER TABLE public.branch_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY branch_reviews_access
  ON public.branch_reviews
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = branch_reviews.branch_id
        AND public.owns_workspace(b.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = branch_reviews.branch_id
        AND public.can_write_workspace(b.workspace_id)
    )
  );

CREATE POLICY branch_comments_access
  ON public.branch_comments
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = branch_comments.branch_id
        AND public.owns_workspace(b.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = branch_comments.branch_id
        AND public.can_write_workspace(b.workspace_id)
    )
  );
