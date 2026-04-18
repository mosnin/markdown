-- Link suggestions: AI-suggested note connections
-- V3 Feature #4: Smart auto-linking with LLM suggestions

CREATE TABLE IF NOT EXISTS link_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  target_note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  suggested_relationship text NOT NULL,
  confidence numeric(3,2) NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, target_note_id)
);

CREATE INDEX ON link_suggestions (note_id) WHERE status = 'pending';
