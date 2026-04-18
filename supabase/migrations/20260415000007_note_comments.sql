-- Note-level discussion threads (V3 Feature #7).
-- Lightweight comments directly on a note — no branch or proposal required.

CREATE TABLE IF NOT EXISTS note_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_comment_id uuid REFERENCES note_comments(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  body text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON note_comments (note_id, created_at);
CREATE INDEX ON note_comments (workspace_id);

ALTER TABLE note_comments ENABLE ROW LEVEL SECURITY;
