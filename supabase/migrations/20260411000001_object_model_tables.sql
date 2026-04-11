-- =============================================================================
-- Context Store — object model expansion: tables
-- Migration: 20260411000001_object_model_tables.sql
--
-- Creates:
--   Tables: workspace_objects, files, skills, agents,
--           object_versions, object_links, box_object_attachments
--   Deferred foreign keys (current_version_id circular refs)
--   Indexes
--   Triggers
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. workspace_objects
--
--    Shared structural registry. Every content object (note, file, skill,
--    agent, folder) has exactly one row here that maps it to its
--    workspace/box/folder placement and carries denormalized display state.
--
--    object_id + object_type form the logical FK to the owning core table.
--    No DB-level FK is possible because the target table varies by type;
--    the service layer is responsible for referential integrity.
--
--    display_name: denormalized from the core table (title / name).
--      Kept in sync by the service layer on every rename.
--
--    is_reusable: true when a skill or agent is workspace-level and may
--      be referenced by multiple boxes. Workspace-level objects may have
--      box_id IS NULL.
-- ---------------------------------------------------------------------------

CREATE TABLE public.workspace_objects (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  box_id         uuid        REFERENCES public.boxes(id) ON DELETE SET NULL,
  folder_id      uuid        REFERENCES public.folders(id) ON DELETE SET NULL,
  object_type    text        NOT NULL
                             CHECK (object_type IN ('note', 'file', 'skill', 'agent', 'folder')),
  object_id      uuid        NOT NULL,
  display_name   text        NOT NULL DEFAULT '',
  sort_order     integer     NOT NULL DEFAULT 0,
  status         text        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('draft', 'active', 'archived', 'trashed')),
  is_reusable    boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (object_type, object_id)
);

CREATE INDEX workspace_objects_workspace_id_object_type_idx
  ON public.workspace_objects (workspace_id, object_type);
CREATE INDEX workspace_objects_box_id_idx
  ON public.workspace_objects (box_id)
  WHERE box_id IS NOT NULL;
CREATE INDEX workspace_objects_workspace_id_is_reusable_idx
  ON public.workspace_objects (workspace_id, is_reusable)
  WHERE is_reusable = true;

CREATE TRIGGER workspace_objects_set_updated_at
  BEFORE UPDATE ON public.workspace_objects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. files
--
--    Non-markdown content artifacts. Stores source text or binary-encoded
--    content alongside format metadata.
--
--    canonical_format: the normalized format used for storage and diffing.
--    source_language / file_extension / mime_type: optional metadata from
--      the original file, used by the UI and export layer.
--
--    current_version_id: FK to object_versions added after that table
--      exists (section 5). Nullable until the first version is created.
--
--    Slug uniqueness per box among non-trashed files uses path_cache so
--      that renames can be resolved deterministically.
--
--    content_bytes: kept in sync with len(source_content) by the service
--      layer so storage accounting is cheap to query.
-- ---------------------------------------------------------------------------

CREATE TABLE public.files (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  box_id              uuid        REFERENCES public.boxes(id) ON DELETE SET NULL,
  folder_id           uuid        REFERENCES public.folders(id) ON DELETE SET NULL,
  name                text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 500),
  slug                text        NOT NULL
                                  CHECK (slug ~ '^[a-z0-9][a-z0-9._-]*[a-z0-9]$' OR slug ~ '^[a-z0-9]$'),
  path_cache          text        NOT NULL DEFAULT '',
  source_content      text        NOT NULL DEFAULT '',
  content_bytes       integer     NOT NULL DEFAULT 0 CHECK (content_bytes >= 0),
  canonical_format    text        NOT NULL DEFAULT 'plain_text'
                                  CHECK (canonical_format IN (
                                    'plain_text', 'json', 'yaml', 'toml', 'xml',
                                    'python', 'typescript', 'javascript', 'shell',
                                    'sql', 'html', 'css', 'markdown', 'binary'
                                  )),
  source_language     text,
  file_extension      text,
  mime_type           text,
  description         text,
  tags                text[]      NOT NULL DEFAULT '{}',
  summary             text,
  status              text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('draft', 'active', 'archived', 'trashed')),
  current_version_id  uuid,       -- FK to object_versions added after (section 5)
  origin_type         text        NOT NULL DEFAULT 'user_created'
                                  CHECK (origin_type IN ('user_created', 'imported', 'generated')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- path_cache unique per box among non-trashed files.
CREATE UNIQUE INDEX files_box_path_cache_active_uidx
  ON public.files (box_id, path_cache)
  WHERE status <> 'trashed' AND box_id IS NOT NULL;

CREATE INDEX files_box_id_idx
  ON public.files (box_id)
  WHERE box_id IS NOT NULL;
CREATE INDEX files_folder_id_idx
  ON public.files (folder_id)
  WHERE folder_id IS NOT NULL;
CREATE INDEX files_box_id_status_idx
  ON public.files (box_id, status);

CREATE TRIGGER files_set_updated_at
  BEFORE UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. skills
--
--    Reusable structured objects — prompt templates, instruction sets, or
--    parameterized procedures that agents and notes can reference.
--
--    is_reusable: when true the skill is workspace-level and box_id may be
--      null. Workspace-level slug uniqueness is enforced separately from
--      box-local path_cache uniqueness.
--
--    current_version_id: FK to object_versions added after (section 5).
-- ---------------------------------------------------------------------------

CREATE TABLE public.skills (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  box_id              uuid        REFERENCES public.boxes(id) ON DELETE SET NULL,
  folder_id           uuid        REFERENCES public.folders(id) ON DELETE SET NULL,
  name                text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 500),
  slug                text        NOT NULL
                                  CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' OR slug ~ '^[a-z0-9]$'),
  path_cache          text        NOT NULL DEFAULT '',
  source_content      text        NOT NULL DEFAULT '',
  content_bytes       integer     NOT NULL DEFAULT 0 CHECK (content_bytes >= 0),
  canonical_format    text        NOT NULL DEFAULT 'markdown'
                                  CHECK (canonical_format IN (
                                    'markdown', 'json', 'yaml', 'typescript', 'python'
                                  )),
  description         text,
  summary             text,
  tags                text[]      NOT NULL DEFAULT '{}',
  is_reusable         boolean     NOT NULL DEFAULT false,
  status              text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('draft', 'active', 'archived', 'trashed')),
  current_version_id  uuid,       -- FK to object_versions added after (section 5)
  origin_type         text        NOT NULL DEFAULT 'user_created'
                                  CHECK (origin_type IN ('user_created', 'imported', 'generated')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Workspace-level reusable skills: slug unique per workspace among non-trashed.
CREATE UNIQUE INDEX skills_workspace_slug_reusable_uidx
  ON public.skills (workspace_id, slug)
  WHERE is_reusable = true AND status <> 'trashed';

-- Box-local skills: path_cache unique per box among non-trashed.
CREATE UNIQUE INDEX skills_box_path_cache_active_uidx
  ON public.skills (box_id, path_cache)
  WHERE status <> 'trashed' AND box_id IS NOT NULL;

CREATE INDEX skills_workspace_id_is_reusable_idx
  ON public.skills (workspace_id, is_reusable);
CREATE INDEX skills_box_id_idx
  ON public.skills (box_id)
  WHERE box_id IS NOT NULL;

CREATE TRIGGER skills_set_updated_at
  BEFORE UPDATE ON public.skills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. agents
--
--    Reusable structured orchestrators — autonomous task executors that may
--    reference skills, notes, and other agents.
--
--    agent_type: broad category hint used by the orchestration layer to
--      select appropriate runners and defaults.
--    model_hint: preferred model reference for informational use.
--      NOT execution configuration — the runner resolves the actual model.
--    system_prompt: the agent's canonical system prompt text.
--
--    is_reusable / current_version_id: same semantics as skills.
-- ---------------------------------------------------------------------------

CREATE TABLE public.agents (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  box_id              uuid        REFERENCES public.boxes(id) ON DELETE SET NULL,
  folder_id           uuid        REFERENCES public.folders(id) ON DELETE SET NULL,
  name                text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 500),
  slug                text        NOT NULL
                                  CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' OR slug ~ '^[a-z0-9]$'),
  path_cache          text        NOT NULL DEFAULT '',
  source_content      text        NOT NULL DEFAULT '',
  content_bytes       integer     NOT NULL DEFAULT 0 CHECK (content_bytes >= 0),
  canonical_format    text        NOT NULL DEFAULT 'markdown'
                                  CHECK (canonical_format IN (
                                    'markdown', 'json', 'yaml', 'typescript', 'python'
                                  )),
  agent_type          text
                                  CHECK (agent_type IN (
                                    'reasoning', 'coding', 'research', 'planning',
                                    'retrieval', 'synthesis', 'orchestration', 'custom'
                                  )),
  model_hint          text,
  system_prompt       text,
  description         text,
  summary             text,
  tags                text[]      NOT NULL DEFAULT '{}',
  is_reusable         boolean     NOT NULL DEFAULT false,
  status              text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('draft', 'active', 'archived', 'trashed')),
  current_version_id  uuid,       -- FK to object_versions added after (section 5)
  origin_type         text        NOT NULL DEFAULT 'user_created'
                                  CHECK (origin_type IN ('user_created', 'imported', 'generated')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Workspace-level reusable agents: slug unique per workspace among non-trashed.
CREATE UNIQUE INDEX agents_workspace_slug_reusable_uidx
  ON public.agents (workspace_id, slug)
  WHERE is_reusable = true AND status <> 'trashed';

-- Box-local agents: path_cache unique per box among non-trashed.
CREATE UNIQUE INDEX agents_box_path_cache_active_uidx
  ON public.agents (box_id, path_cache)
  WHERE status <> 'trashed' AND box_id IS NOT NULL;

CREATE INDEX agents_workspace_id_is_reusable_idx
  ON public.agents (workspace_id, is_reusable);
CREATE INDEX agents_box_id_idx
  ON public.agents (box_id)
  WHERE box_id IS NOT NULL;

CREATE TRIGGER agents_set_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. object_versions
--
--    Immutable version history for files, skills, and agents. Full content
--    snapshot per version. Maintains a linked list via parent_version_id.
--
--    object_type / object_id: polymorphic pointer to the owning row in
--      files, skills, or agents. No DB-level FK due to the polymorphic
--      target; the service layer enforces referential integrity.
--
--    actor_type / actor_id: who created this version.
--      actor_type = 'user'       → actor_id is auth.users.id (uuid as text)
--      actor_type = 'connection' → actor_id is connections.id (uuid as text)
--      actor_type = 'system'     → actor_id = 'system'
--
--    change_origin: how this version came to be.
--    diff_summary: lightweight jsonb summary of what changed (optional).
--
--    No updated_at — these rows are immutable once written.
--    No UPDATE or DELETE RLS policies for the same reason.
-- ---------------------------------------------------------------------------

CREATE TABLE public.object_versions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type       text        NOT NULL
                                CHECK (object_type IN ('file', 'skill', 'agent')),
  object_id         uuid        NOT NULL,
  parent_version_id uuid        REFERENCES public.object_versions(id) ON DELETE RESTRICT,
  version_number    integer     NOT NULL CHECK (version_number > 0),
  source_content    text        NOT NULL DEFAULT '',
  content_bytes     integer     NOT NULL DEFAULT 0 CHECK (content_bytes >= 0),
  actor_type        text        NOT NULL CHECK (actor_type IN ('user', 'connection', 'system')),
  actor_id          text        NOT NULL,
  change_origin     text        NOT NULL DEFAULT 'human_edit'
                                CHECK (change_origin IN (
                                  'human_edit', 'import', 'generated',
                                  'proposal_approved', 'rollback'
                                )),
  diff_summary      jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (object_type, object_id, version_number)
);

CREATE INDEX object_versions_object_created_at_idx
  ON public.object_versions (object_type, object_id, created_at DESC);
CREATE INDEX object_versions_parent_version_id_idx
  ON public.object_versions (parent_version_id)
  WHERE parent_version_id IS NOT NULL;

-- Now that object_versions exists, add the deferred FKs from files, skills, agents.
ALTER TABLE public.files
  ADD CONSTRAINT files_current_version_id_fkey
  FOREIGN KEY (current_version_id)
  REFERENCES public.object_versions(id)
  ON DELETE SET NULL;

ALTER TABLE public.skills
  ADD CONSTRAINT skills_current_version_id_fkey
  FOREIGN KEY (current_version_id)
  REFERENCES public.object_versions(id)
  ON DELETE SET NULL;

ALTER TABLE public.agents
  ADD CONSTRAINT agents_current_version_id_fkey
  FOREIGN KEY (current_version_id)
  REFERENCES public.object_versions(id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 6. object_links
--
--    Heterogeneous relationships between any two content objects regardless
--    of type. Workspace-scoped for ownership and RLS derivation.
--
--    source/target object_type + object_id: polymorphic pointers. The DB
--      cannot enforce FK integrity across polymorphic targets; the service
--      layer validates existence before insert.
--
--    Self-links are rejected by CHECK constraint.
--    Links are replaced not mutated — no UPDATE policy.
--
--    relationship_type vocabulary (10 canonical values, matches note_links):
--      related, depends_on, parent_of, child_of, reference_for,
--      extends, example_of, sibling_of, supersedes, derived_from
-- ---------------------------------------------------------------------------

CREATE TABLE public.object_links (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_object_type   text        NOT NULL
                                   CHECK (source_object_type IN (
                                     'note', 'file', 'skill', 'agent', 'folder'
                                   )),
  source_object_id     uuid        NOT NULL,
  target_object_type   text        NOT NULL
                                   CHECK (target_object_type IN (
                                     'note', 'file', 'skill', 'agent', 'folder'
                                   )),
  target_object_id     uuid        NOT NULL,
  relationship_type    text        NOT NULL
                                   CHECK (relationship_type IN (
                                     'related', 'depends_on', 'parent_of', 'child_of',
                                     'reference_for', 'extends', 'example_of',
                                     'sibling_of', 'supersedes', 'derived_from'
                                   )),
  relationship_note    text,
  created_at           timestamptz NOT NULL DEFAULT now(),

  -- No self-links.
  CHECK (
    (source_object_type, source_object_id) <> (target_object_type, target_object_id)
  ),
  UNIQUE (source_object_type, source_object_id, target_object_type, target_object_id, relationship_type)
);

CREATE INDEX object_links_workspace_source_idx
  ON public.object_links (workspace_id, source_object_type, source_object_id);
CREATE INDEX object_links_workspace_target_idx
  ON public.object_links (workspace_id, target_object_type, target_object_id);

-- ---------------------------------------------------------------------------
-- 7. box_object_attachments
--
--    Join table: workspace-level reusable skills and agents attached into
--    specific boxes by reference. A reusable object may appear in many
--    boxes via this table without being duplicated.
--
--    object_id: FK to skills.id or agents.id. No DB-level FK is possible
--      due to the polymorphic target; the service layer validates existence
--      and confirms is_reusable = true before inserting.
--
--    attached_by: the auth.users.id of the user who created the attachment.
--      Nullable to survive user deletion.
--
--    No updated_at — the row is an immutable join; detach and re-attach
--      to change sort_order or folder placement.
-- ---------------------------------------------------------------------------

CREATE TABLE public.box_object_attachments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  box_id       uuid        NOT NULL REFERENCES public.boxes(id) ON DELETE CASCADE,
  folder_id    uuid        REFERENCES public.folders(id) ON DELETE SET NULL,
  object_type  text        NOT NULL CHECK (object_type IN ('skill', 'agent')),
  object_id    uuid        NOT NULL,
  sort_order   integer     NOT NULL DEFAULT 0,
  attached_at  timestamptz NOT NULL DEFAULT now(),
  attached_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  UNIQUE (box_id, object_type, object_id)
);

CREATE INDEX box_object_attachments_box_id_object_type_idx
  ON public.box_object_attachments (box_id, object_type);
CREATE INDEX box_object_attachments_workspace_id_idx
  ON public.box_object_attachments (workspace_id);
