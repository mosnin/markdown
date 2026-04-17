-- Add 'rolled_back' to the draft_branches status CHECK constraint,
-- plus columns to track rollback metadata.

ALTER TABLE public.draft_branches DROP CONSTRAINT IF EXISTS draft_branches_status_check;
ALTER TABLE public.draft_branches ADD CONSTRAINT draft_branches_status_check
  CHECK (status IN ('open', 'promoting', 'promoted', 'discarded', 'rolled_back'));

ALTER TABLE public.draft_branches
  ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz,
  ADD COLUMN IF NOT EXISTS rollback_change_set_id uuid REFERENCES public.change_sets(id);
