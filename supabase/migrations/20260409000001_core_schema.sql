-- =============================================================================
-- Context Store — core schema
-- Migration: 20260409000001_core_schema.sql
--
-- Creates:
--   Helper functions (set_updated_at, owns_workspace)
--   Tables: workspaces, boxes, folders, notes, note_versions,
--           note_links, connections, connection_tokens,
--           connection_box_scopes, write_proposals, audit_events
--   Deferred foreign keys (circular refs)
--   Indexes
--   Triggers
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid() on older PG

-- ---------------------------------------------------------------------------
-- 1. Helper: set_updated_at trigger function
--    Applied to every table with an updated_at column.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. workspaces
--
--    Top-level organizational unit. Owned by a single auth user in V1.
--    owner_id references auth.users — not a profile table — so workspace
--    ownership is always derivable from the auth token alone.
-- ---------------------------------------------------------------------------

CREATE TABLE public.workspaces (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name         text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  slug         text        NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' OR slug ~ '^[a-z0-9]$'),
  description  text,
  status       text        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'archived', 'trashed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (owner_id, slug)
);

CREATE TRIGGER workspaces_set_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. boxes
--
--    A focused collection within a workspace. Boxes are the primary
--    organizational and permission scope unit in V1.
--
--    guide_note_id: the single canonical guide note for this box.
--      Added as a deferred FK after notes table exists (see section 6).
--      Application code must guard against trashing a guide note without
--      clearing this pointer — the database alone does not enforce this.
--
--    slug uniqueness: enforced per-workspace among non-trashed boxes only.
-- ---------------------------------------------------------------------------

CREATE TABLE public.boxes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  guide_note_id   uuid,       -- FK to notes added after notes table (section 6)
  name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  slug            text        NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' OR slug ~ '^[a-z0-9]$'),
  description     text,
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('draft', 'active', 'archived', 'trashed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Slug unique per workspace among non-trashed boxes.
CREATE UNIQUE INDEX boxes_workspace_slug_active_uidx
  ON public.boxes (workspace_id, slug)
  WHERE status <> 'trashed';

CREATE INDEX boxes_workspace_id_idx ON public.boxes (workspace_id);

CREATE TRIGGER boxes_set_updated_at
  BEFORE UPDATE ON public.boxes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. folders
--
--    Optional grouping within a box. Supports arbitrary nesting via
--    parent_folder_id. Folders are purely organizational — no semantic
--    meaning beyond structure.
--
--    path_cache: derived full path, e.g. '/research/papers'. Maintained
--      by the application. Indexed for uniqueness per box (non-trashed).
--
--    accepts_generated_notes: when true, AI connections with
--      'generate_in_allowed_folders' permission mode may write to this
--      folder. Defaults false for safety.
-- ---------------------------------------------------------------------------

CREATE TABLE public.folders (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id               uuid        NOT NULL REFERENCES public.boxes(id) ON DELETE RESTRICT,
  parent_folder_id     uuid        REFERENCES public.folders(id) ON DELETE RESTRICT,
  name                 text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  slug                 text        NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' OR slug ~ '^[a-z0-9]$'),
  path_cache           text        NOT NULL,
  description          text,
  accepts_generated_notes boolean  NOT NULL DEFAULT false,
  status               text        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active', 'archived', 'trashed')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- path_cache unique per box among non-trashed folders.
CREATE UNIQUE INDEX folders_box_path_cache_active_uidx
  ON public.folders (box_id, path_cache)
  WHERE status <> 'trashed';

CREATE INDEX folders_box_id_idx ON public.folders (box_id);
CREATE INDEX folders_parent_folder_id_idx ON public.folders (parent_folder_id)
  WHERE parent_folder_id IS NOT NULL;

CREATE TRIGGER folders_set_updated_at
  BEFORE UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. notes
--
--    The primary content unit. Notes belong to a box and optionally to
--    a folder. Root-level notes (folder_id IS NULL) sit directly in the box.
--
--    kind: 'note' | 'guide' | 'bundle' — the note's intended type.
--      Being a guide in terms of kind does not make it THE guide for the box.
--      THE guide is determined by boxes.guide_note_id only. Do not store a
--      separate is_guide_note boolean here.
--
--    current_version_id: FK to note_versions added after that table exists
--      (section 6). Nullable until the first version is created.
--
--    origin_type / is_generated: track provenance.
--    generated_by_connection_id: FK to connections added after that table.
--
--    path_cache: derived full path, e.g. '/research/papers/my-note'.
--      Uniqueness enforced per box among non-trashed notes.
--
--    retrieval_priority: 0–10 hint for AI retrieval ordering. Default 0.
--
--    content_bytes: kept in sync with len(markdown_content) by the
--      application so storage accounting is cheap to query.
-- ---------------------------------------------------------------------------

CREATE TABLE public.notes (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id                    uuid        NOT NULL REFERENCES public.boxes(id) ON DELETE RESTRICT,
  folder_id                 uuid        REFERENCES public.folders(id) ON DELETE RESTRICT,
  current_version_id        uuid,       -- FK to note_versions added after (section 6)
  title                     text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  slug                      text        NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' OR slug ~ '^[a-z0-9]$'),
  path_cache                text        NOT NULL,
  markdown_content          text        NOT NULL DEFAULT '',
  content_bytes             integer     NOT NULL DEFAULT 0 CHECK (content_bytes >= 0),
  summary                   text,
  tags                      text[]      NOT NULL DEFAULT '{}',
  read_hint                 text,
  retrieval_priority        integer     NOT NULL DEFAULT 0 CHECK (retrieval_priority BETWEEN 0 AND 10),
  kind                      text        NOT NULL DEFAULT 'note'
                                        CHECK (kind IN ('note', 'guide', 'bundle')),
  status                    text        NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('draft', 'active', 'archived', 'trashed')),
  origin_type               text        NOT NULL DEFAULT 'human'
                                        CHECK (origin_type IN ('human', 'generated', 'imported')),
  is_generated              boolean     NOT NULL DEFAULT false,
  generated_by_connection_id uuid,      -- FK to connections added after (section 6)
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- path_cache unique per box among non-trashed notes.
CREATE UNIQUE INDEX notes_box_path_cache_active_uidx
  ON public.notes (box_id, path_cache)
  WHERE status <> 'trashed';

CREATE INDEX notes_box_id_idx ON public.notes (box_id);
CREATE INDEX notes_folder_id_idx ON public.notes (folder_id)
  WHERE folder_id IS NOT NULL;
CREATE INDEX notes_current_version_id_idx ON public.notes (current_version_id)
  WHERE current_version_id IS NOT NULL;
CREATE INDEX notes_tags_idx ON public.notes USING GIN (tags);
CREATE INDEX notes_status_idx ON public.notes (box_id, status);

CREATE TRIGGER notes_set_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. note_versions
--
--    Full content snapshot per version. Immutable once written.
--    Maintains a linked list via parent_version_id.
--
--    actor_type / actor_id: who made this version.
--      actor_type = 'user'       → actor_id is auth.users.id (uuid as text)
--      actor_type = 'connection' → actor_id is connections.id (uuid as text)
--      actor_type = 'system'     → actor_id = 'system'
--
--    change_origin: how this version came to be.
--    diff_summary: lightweight jsonb summary of what changed.
--    diff_patch: full unified diff or structured patch (optional).
--
--    No UPDATE policy — these rows are append-only.
-- ---------------------------------------------------------------------------

CREATE TABLE public.note_versions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id          uuid        NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  parent_version_id uuid       REFERENCES public.note_versions(id) ON DELETE RESTRICT,
  version_number   integer     NOT NULL CHECK (version_number > 0),
  title            text        NOT NULL,
  markdown_content text        NOT NULL DEFAULT '',
  content_bytes    integer     NOT NULL DEFAULT 0 CHECK (content_bytes >= 0),
  actor_type       text        NOT NULL CHECK (actor_type IN ('user', 'connection', 'system')),
  actor_id         text        NOT NULL,
  change_origin    text        NOT NULL
                               CHECK (change_origin IN (
                                 'human_edit', 'import', 'generated', 'proposal_approved'
                               )),
  diff_summary     jsonb,
  diff_patch       text,
  created_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (note_id, version_number)
);

CREATE INDEX note_versions_note_id_created_at_idx
  ON public.note_versions (note_id, created_at DESC);
CREATE INDEX note_versions_parent_version_id_idx
  ON public.note_versions (parent_version_id)
  WHERE parent_version_id IS NOT NULL;

-- Now that note_versions exists, add the deferred FK from notes.
ALTER TABLE public.notes
  ADD CONSTRAINT notes_current_version_id_fkey
  FOREIGN KEY (current_version_id)
  REFERENCES public.note_versions(id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 7. note_links
--
--    Explicit note-to-note relationships. Same-box only in V1 — enforced
--    at the application/service layer because a cross-table CHECK constraint
--    is not supported in Postgres. The service layer must validate that
--    source and target share the same box_id before inserting.
--
--    Self-links are rejected by CHECK constraint.
-- ---------------------------------------------------------------------------

CREATE TABLE public.note_links (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_note_id    uuid        NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  target_note_id    uuid        NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  relationship_type text        NOT NULL
                                CHECK (relationship_type IN (
                                  'related', 'references', 'extends', 'contradicts', 'supersedes'
                                )),
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- No self-links.
  CHECK (source_note_id <> target_note_id),
  -- Unique on source, target, relationship_type.
  UNIQUE (source_note_id, target_note_id, relationship_type)
);

CREATE INDEX note_links_source_note_id_idx ON public.note_links (source_note_id);
CREATE INDEX note_links_target_note_id_idx ON public.note_links (target_note_id);

-- ---------------------------------------------------------------------------
-- 8. connections
--
--    A connection represents an authorized external agent (MCP client,
--    API integration, webhook) with scoped access to one workspace.
--
--    permission_mode:
--      'read_only'                  — may only read notes and metadata
--      'propose_writes'             — may submit write_proposals for review
--      'generate_in_allowed_folders'— may write directly to folders
--                                      where accepts_generated_notes = true
-- ---------------------------------------------------------------------------

CREATE TABLE public.connections (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description     text,
  connection_type text        NOT NULL CHECK (connection_type IN ('mcp', 'api', 'webhook')),
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'suspended', 'revoked')),
  permission_mode text        NOT NULL
                              CHECK (permission_mode IN (
                                'read_only', 'propose_writes', 'generate_in_allowed_folders'
                              )),
  last_used_at    timestamptz,
  usage_count     integer     NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX connections_workspace_id_status_idx
  ON public.connections (workspace_id, status);

CREATE TRIGGER connections_set_updated_at
  BEFORE UPDATE ON public.connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Now that connections exists, add the deferred FK from notes.
ALTER TABLE public.notes
  ADD CONSTRAINT notes_generated_by_connection_id_fkey
  FOREIGN KEY (generated_by_connection_id)
  REFERENCES public.connections(id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 9. connection_tokens
--
--    Credential tokens for connections. Never store raw secrets.
--    token_prefix (first ~8 chars) is used for lookup; secret_hash
--    is a bcrypt/argon2 hash verified at token validation time.
--
--    Supports rotation: old tokens can be revoked while new ones are active.
-- ---------------------------------------------------------------------------

CREATE TABLE public.connection_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid        NOT NULL REFERENCES public.connections(id) ON DELETE CASCADE,
  token_prefix  text        NOT NULL CHECK (char_length(token_prefix) >= 6),
  secret_hash   text        NOT NULL,
  label         text,
  status        text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at    timestamptz,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Primary lookup path: prefix + status. Used during token verification.
CREATE INDEX connection_tokens_prefix_status_idx
  ON public.connection_tokens (token_prefix, status);
CREATE INDEX connection_tokens_connection_id_idx
  ON public.connection_tokens (connection_id);

-- ---------------------------------------------------------------------------
-- 10. connection_box_scopes
--
--     Join table: which boxes a connection has access to.
--     Box is the scope unit in V1 — no folder-scoped permissions yet.
-- ---------------------------------------------------------------------------

CREATE TABLE public.connection_box_scopes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid        NOT NULL REFERENCES public.connections(id) ON DELETE CASCADE,
  box_id        uuid        NOT NULL REFERENCES public.boxes(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (connection_id, box_id)
);

CREATE INDEX connection_box_scopes_connection_id_idx
  ON public.connection_box_scopes (connection_id);
CREATE INDEX connection_box_scopes_box_id_idx
  ON public.connection_box_scopes (box_id);

-- Now that connections exists, add the deferred FK from boxes.
ALTER TABLE public.boxes
  ADD CONSTRAINT boxes_guide_note_id_fkey
  FOREIGN KEY (guide_note_id)
  REFERENCES public.notes(id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 11. write_proposals
--
--     A connection's request to create or modify a note, pending human review.
--     Tracks the target note, the proposed content, the reviewer, and the
--     artifact references for approved proposals.
--
--     target_version_id: the version of the note at proposal time.
--       If the note has been updated since (target_version_id != current),
--       status should be set to 'conflicted'.
--
--     approved_note_id / approved_version_id: populated when a 'create_note'
--       proposal is approved and a new note is created.
-- ---------------------------------------------------------------------------

CREATE TABLE public.write_proposals (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  connection_id        uuid        NOT NULL REFERENCES public.connections(id) ON DELETE RESTRICT,
  target_note_id       uuid        REFERENCES public.notes(id) ON DELETE SET NULL,
  target_version_id    uuid        REFERENCES public.note_versions(id) ON DELETE SET NULL,
  proposal_type        text        NOT NULL
                                   CHECK (proposal_type IN (
                                     'create_note', 'update_note', 'append_note', 'replace_note'
                                   )),
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN (
                                     'pending', 'approved', 'rejected',
                                     'conflicted', 'canceled', 'expired'
                                   )),
  proposed_title       text,
  proposed_content     text,
  proposed_folder_id   uuid        REFERENCES public.folders(id) ON DELETE SET NULL,
  rationale            text,
  reviewer_id          uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at          timestamptz,
  review_note          text,
  approved_note_id     uuid        REFERENCES public.notes(id) ON DELETE SET NULL,
  approved_version_id  uuid        REFERENCES public.note_versions(id) ON DELETE SET NULL,
  expires_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX write_proposals_workspace_id_idx
  ON public.write_proposals (workspace_id);
CREATE INDEX write_proposals_target_note_id_status_idx
  ON public.write_proposals (target_note_id, status)
  WHERE target_note_id IS NOT NULL;
CREATE INDEX write_proposals_connection_id_idx
  ON public.write_proposals (connection_id);
CREATE INDEX write_proposals_status_idx
  ON public.write_proposals (workspace_id, status, created_at DESC);

CREATE TRIGGER write_proposals_set_updated_at
  BEFORE UPDATE ON public.write_proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 12. audit_events
--
--     Append-only workspace-scoped event log. Immutable once written.
--     Never mutable through application code.
--
--     object_type: the entity kind (e.g. 'note', 'box', 'connection')
--     object_id:   the entity's uuid as text
--     event_type:  a dot-separated label, e.g. 'note.created', 'box.archived'
-- ---------------------------------------------------------------------------

CREATE TABLE public.audit_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  actor_type   text        NOT NULL CHECK (actor_type IN ('user', 'connection', 'system')),
  actor_id     text        NOT NULL,
  object_type  text        NOT NULL CHECK (char_length(object_type) > 0),
  object_id    text        NOT NULL,
  event_type   text        NOT NULL CHECK (char_length(event_type) > 0),
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
  -- No updated_at — audit events are immutable.
);

CREATE INDEX audit_events_workspace_id_created_at_idx
  ON public.audit_events (workspace_id, created_at DESC);
CREATE INDEX audit_events_object_idx
  ON public.audit_events (workspace_id, object_type, object_id);
CREATE INDEX audit_events_actor_idx
  ON public.audit_events (workspace_id, actor_type, actor_id);

-- ---------------------------------------------------------------------------
-- 13. RLS helper function
--
--     owns_workspace(wid) — returns true if the current auth.uid() is the
--     owner of workspace `wid`. Used in child-table RLS policies to avoid
--     deeply nested subqueries and improve readability.
--
--     SECURITY DEFINER so it can read workspaces even when the calling
--     policy context is on a child table. search_path locked to public.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.owns_workspace(wid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces
    WHERE id = wid
      AND owner_id = auth.uid()
  );
$$;
