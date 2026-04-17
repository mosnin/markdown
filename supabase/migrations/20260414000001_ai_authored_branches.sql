-- AI-authored branches: track which MCP client created a branch
-- created_by stays as the human owner; these columns are metadata
-- for UI display ("Authored by Claude via MCP").

ALTER TABLE draft_branches
  ADD COLUMN authored_by_connection_id uuid REFERENCES connections(id) ON DELETE SET NULL,
  ADD COLUMN authored_by_client_id text REFERENCES oauth_clients(client_id) ON DELETE SET NULL;

COMMENT ON COLUMN draft_branches.authored_by_connection_id IS 'OAuth connection that created this branch via MCP, if any';
COMMENT ON COLUMN draft_branches.authored_by_client_id IS 'OAuth client_id that created this branch via MCP, if any';
