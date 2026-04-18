-- Content webhooks: workspace admins register HTTP endpoints that receive
-- events when notes/links/files change. Enables integrations with Slack,
-- external dashboards, etc.

CREATE TABLE IF NOT EXISTS content_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  secret text NOT NULL,
  event_types text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS content_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES content_webhooks(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  response_status integer,
  response_body text,
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON content_webhook_deliveries (webhook_id, created_at DESC);
CREATE INDEX ON content_webhook_deliveries (status) WHERE status = 'pending';

ALTER TABLE content_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_webhook_deliveries ENABLE ROW LEVEL SECURITY;
