-- V3 RLS hardening: add missing policies to tables created by V3 agents
-- Fixes 5 critical/high audit findings

-- 1. note_embeddings — no RLS at all
ALTER TABLE IF EXISTS note_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY note_embeddings_select ON note_embeddings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM notes
    JOIN boxes ON boxes.id = notes.box_id
    WHERE notes.id = note_embeddings.note_id
      AND public.owns_workspace(boxes.workspace_id)
  ));

CREATE POLICY note_embeddings_insert ON note_embeddings FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM notes
    JOIN boxes ON boxes.id = notes.box_id
    WHERE notes.id = note_embeddings.note_id
      AND public.can_write_workspace(boxes.workspace_id)
  ));

CREATE POLICY note_embeddings_update ON note_embeddings FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM notes
    JOIN boxes ON boxes.id = notes.box_id
    WHERE notes.id = note_embeddings.note_id
      AND public.can_write_workspace(boxes.workspace_id)
  ));

CREATE POLICY note_embeddings_delete ON note_embeddings FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM notes
    JOIN boxes ON boxes.id = notes.box_id
    WHERE notes.id = note_embeddings.note_id
      AND public.can_write_workspace(boxes.workspace_id)
  ));

-- 2. link_suggestions — no RLS at all
ALTER TABLE IF EXISTS link_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY link_suggestions_select ON link_suggestions FOR SELECT
  USING (public.owns_workspace(workspace_id));

CREATE POLICY link_suggestions_insert ON link_suggestions FOR INSERT
  WITH CHECK (public.can_write_workspace(workspace_id));

CREATE POLICY link_suggestions_update ON link_suggestions FOR UPDATE
  USING (public.can_write_workspace(workspace_id));

CREATE POLICY link_suggestions_delete ON link_suggestions FOR DELETE
  USING (public.can_write_workspace(workspace_id));

-- 3. search_analytics — no RLS at all (admin-only reads, any member inserts)
ALTER TABLE IF EXISTS search_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY search_analytics_select ON search_analytics FOR SELECT
  USING (public.owns_workspace(workspace_id));

CREATE POLICY search_analytics_insert ON search_analytics FOR INSERT
  WITH CHECK (public.owns_workspace(workspace_id));

-- 4. note_templates — RLS enabled but zero policies (permadeny)
CREATE POLICY note_templates_select ON note_templates FOR SELECT
  USING (public.owns_workspace(workspace_id));

CREATE POLICY note_templates_insert ON note_templates FOR INSERT
  WITH CHECK (public.can_write_workspace(workspace_id));

CREATE POLICY note_templates_update ON note_templates FOR UPDATE
  USING (public.can_write_workspace(workspace_id));

CREATE POLICY note_templates_delete ON note_templates FOR DELETE
  USING (public.can_write_workspace(workspace_id));

-- 5. content_webhooks + content_webhook_deliveries — RLS enabled but zero policies
CREATE POLICY content_webhooks_select ON content_webhooks FOR SELECT
  USING (public.owns_workspace(workspace_id));

CREATE POLICY content_webhooks_insert ON content_webhooks FOR INSERT
  WITH CHECK (public.can_write_workspace(workspace_id));

CREATE POLICY content_webhooks_update ON content_webhooks FOR UPDATE
  USING (public.can_write_workspace(workspace_id));

CREATE POLICY content_webhooks_delete ON content_webhooks FOR DELETE
  USING (public.can_write_workspace(workspace_id));

CREATE POLICY content_webhook_deliveries_select ON content_webhook_deliveries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM content_webhooks
    WHERE content_webhooks.id = content_webhook_deliveries.webhook_id
      AND public.owns_workspace(content_webhooks.workspace_id)
  ));
