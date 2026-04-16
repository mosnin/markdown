ALTER TABLE public.draft_branches DROP CONSTRAINT IF EXISTS draft_branches_status_check;
ALTER TABLE public.draft_branches ADD CONSTRAINT draft_branches_status_check CHECK (status IN ('open', 'promoting', 'promoted', 'discarded'));
