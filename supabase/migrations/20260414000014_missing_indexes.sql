-- Pre-launch: add indexes flagged by the performance audit.
--
-- Only indexes that do not already exist are included. Existing coverage:
--   branch_reviews_active_branch_idx  → branch_reviews_branch_idx (same predicate)
--   branch_comments_branch_idx        → branch_comments_branch_object_idx (same columns)
--   gate_runs_branch_latest_idx       → gate_runs_branch_idx (same columns)
--   webauthn_credentials_user_idx     → unnamed index on (user_id) already exists
--   rate_limit_buckets_key_window_idx → already exists
--   change_set_items_cs_idx           → change_set_items_change_set_id_idx already exists

-- branch_pending_ops: non-partial index for promote-scan.
-- The existing branch_pending_ops_branch_idx is partial (WHERE applied_at IS NULL)
-- which cannot serve the promote-scan that needs to read applied rows too.
CREATE INDEX IF NOT EXISTS branch_pending_ops_branch_applied_idx
  ON public.branch_pending_ops (branch_id, applied_at);

-- oauth_access_tokens: workspace + user for grant management UI.
-- Existing indexes cover (user_id, client_id) and (token_prefix) but not
-- workspace-scoped token listing.
CREATE INDEX IF NOT EXISTS oauth_access_tokens_workspace_user_idx
  ON public.oauth_access_tokens (workspace_id, user_id)
  WHERE revoked_at IS NULL;
