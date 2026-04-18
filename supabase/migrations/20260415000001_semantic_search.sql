-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS note_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  embedding vector(1536),
  model text NOT NULL DEFAULT 'text-embedding-3-small',
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id)
);

CREATE INDEX ON note_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
