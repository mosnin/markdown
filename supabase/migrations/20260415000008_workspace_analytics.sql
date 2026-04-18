-- Workspace analytics: search query tracking for analytics dashboard.
--
-- Records every search query for analytics: top queries, zero-result
-- queries, search-type distribution, and click-through tracking.

CREATE TABLE IF NOT EXISTS search_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  query text NOT NULL,
  result_count integer NOT NULL DEFAULT 0,
  clicked_result_id uuid,
  search_type text NOT NULL DEFAULT 'keyword' CHECK (search_type IN ('keyword', 'semantic', 'hybrid')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON search_analytics (workspace_id, created_at DESC);
CREATE INDEX ON search_analytics (workspace_id, query);
