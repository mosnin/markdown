-- V3 deep audit fixes: missing RPC + missing RLS policies + service hardening

-- 1. CRITICAL: match_note_embeddings RPC never created (semantic search silently fails)
CREATE OR REPLACE FUNCTION match_note_embeddings(
  query_embedding vector(1536),
  match_workspace_id uuid,
  match_limit int DEFAULT 10,
  match_branch_id uuid DEFAULT NULL
) RETURNS TABLE(note_id uuid, title text, summary text, markdown_content text, similarity float8)
LANGUAGE SQL STABLE AS $$
  SELECT ne.note_id, n.title, n.summary, n.markdown_content,
    1 - (ne.embedding <=> query_embedding) AS similarity
  FROM note_embeddings ne
  JOIN notes n ON n.id = ne.note_id
  WHERE n.workspace_id = match_workspace_id
    AND n.status != 'trashed'
    AND (n.branch_id IS NULL OR n.branch_id = match_branch_id)
  ORDER BY similarity DESC
  LIMIT match_limit;
$$;

-- 2. CRITICAL: note_comments has RLS enabled but zero policies (permadeny)
CREATE POLICY IF NOT EXISTS note_comments_select ON note_comments FOR SELECT
  USING (public.owns_workspace(workspace_id));

CREATE POLICY IF NOT EXISTS note_comments_insert ON note_comments FOR INSERT
  WITH CHECK (public.can_write_workspace(workspace_id));

CREATE POLICY IF NOT EXISTS note_comments_update ON note_comments FOR UPDATE
  USING (public.can_write_workspace(workspace_id));

CREATE POLICY IF NOT EXISTS note_comments_delete ON note_comments FOR DELETE
  USING (public.can_write_workspace(workspace_id));
