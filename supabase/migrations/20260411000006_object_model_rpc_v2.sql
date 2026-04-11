-- =============================================================================
-- Context Store — object model RPC v2 (corrective migration)
-- Migration: 20260411000006_object_model_rpc_v2.sql
--
-- Replaces the two RPC functions introduced in 20260411000004 with correct
-- signatures that match what the TypeScript services actually call.
--
-- Changes:
--   1. DROP + REPLACE create_object_with_initial_version
--      Old: (text, uuid, uuid, text, text, text, text) → uuid
--        — took an already-existing object_id and only created the version row.
--      New: (text, uuid, text, text, text, …) → jsonb { object, version }
--        — atomically INSERTs the owning row (file / skill / agent), creates
--          version 1, sets current_version_id, and returns both rows as jsonb.
--
--   2. CREATE append_initial_object_version
--      Preserves the old "small" behaviour for write_proposal_service which
--      inserts the object row itself and then needs only the first version row.
--      Signature: (text, uuid, uuid, text, text, text, text) → uuid
--      (identical to the old create_object_with_initial_version).
--
--   3. DROP + REPLACE update_object_and_create_version
--      Old: (text, uuid, text, text, jsonb, text, text) → uuid
--        — updated only source_content / content_bytes, returned version uuid.
--      New: (text, uuid, text, …metadata…) → jsonb { object, version }
--        — also updates description, tags, summary, and agent-specific fields;
--          returns the full updated object + version rows as jsonb.
--
-- Security: SECURITY INVOKER throughout. RLS on files / skills / agents /
-- object_versions enforces workspace ownership for human sessions. Service-role
-- callers (admin client) bypass RLS by default.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Drop old create_object_with_initial_version (returns uuid, simple sig)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_object_with_initial_version(
  text, uuid, uuid, text, text, text, text
);


-- ---------------------------------------------------------------------------
-- 2. create_object_with_initial_version (BIG — full object + version create)
--
--    Atomically:
--      a. INSERTs the owning row in files / skills / agents with all metadata
--      b. INSERTs version 1 in object_versions
--      c. Sets current_version_id on the owning row
--      d. Returns jsonb { "object": <owning row>, "version": <version row> }
--
--    Called by: file_service, skill_service, agent_service, import_service.
--
--    Parameters:
--      p_object_type      — 'file' | 'skill' | 'agent'
--      p_workspace_id     — workspace the object belongs to
--      p_actor_id         — auth.users.id (uuid as text) or 'system'
--      p_name             — display name
--      p_slug             — url-safe slug
--      p_source_content   — full source text (default '')
--      p_content_bytes    — byte length (computed from p_source_content if NULL)
--      p_canonical_format — normalized format (default 'markdown')
--      p_box_id           — owning box (NULL for workspace-level reusable objects)
--      p_folder_id        — owning folder (NULL for root-level objects)
--      p_path_cache       — denormalized path string (default '')
--      p_source_language  — [file] optional source language hint
--      p_file_extension   — [file] optional file extension hint
--      p_mime_type        — [file] optional MIME type hint
--      p_description      — optional description text
--      p_tags             — tag array (default '{}')
--      p_summary          — optional summary text
--      p_is_reusable      — [skill/agent] workspace-level flag (default false)
--      p_origin_type      — 'user_created' | 'imported' | 'generated'
--      p_agent_type       — [agent] agent category hint
--      p_model_hint       — [agent] preferred model reference
--      p_system_prompt    — [agent] canonical system prompt
--
--    Returns: jsonb — { "object": {...}, "version": {...} }
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_object_with_initial_version(
  p_object_type      text,
  p_workspace_id     uuid,
  p_actor_id         text,
  p_name             text,
  p_slug             text,
  p_source_content   text        DEFAULT '',
  p_content_bytes    integer     DEFAULT NULL,
  p_canonical_format text        DEFAULT 'markdown',
  p_box_id           uuid        DEFAULT NULL,
  p_folder_id        uuid        DEFAULT NULL,
  p_path_cache       text        DEFAULT '',
  p_source_language  text        DEFAULT NULL,
  p_file_extension   text        DEFAULT NULL,
  p_mime_type        text        DEFAULT NULL,
  p_description      text        DEFAULT NULL,
  p_tags             text[]      DEFAULT '{}',
  p_summary          text        DEFAULT NULL,
  p_is_reusable      boolean     DEFAULT false,
  p_origin_type      text        DEFAULT 'user_created',
  p_agent_type       text        DEFAULT NULL,
  p_model_hint       text        DEFAULT NULL,
  p_system_prompt    text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_object_id     uuid;
  v_version_id    uuid;
  v_content_bytes integer;
  v_object_row    jsonb;
  v_version_row   jsonb;
BEGIN
  v_content_bytes := COALESCE(p_content_bytes, octet_length(p_source_content::bytea));

  -- ── a. Insert the owning row ─────────────────────────────────────────────
  IF p_object_type = 'file' THEN
    INSERT INTO public.files (
      workspace_id, box_id, folder_id,
      name, slug, path_cache,
      source_content, content_bytes, canonical_format,
      source_language, file_extension, mime_type,
      description, tags, summary,
      origin_type, status
    ) VALUES (
      p_workspace_id, p_box_id, p_folder_id,
      p_name, p_slug, p_path_cache,
      p_source_content, v_content_bytes, p_canonical_format,
      p_source_language, p_file_extension, p_mime_type,
      p_description, COALESCE(p_tags, '{}'), p_summary,
      p_origin_type, 'active'
    )
    RETURNING id INTO v_object_id;

  ELSIF p_object_type = 'skill' THEN
    INSERT INTO public.skills (
      workspace_id, box_id, folder_id,
      name, slug, path_cache,
      source_content, content_bytes, canonical_format,
      description, tags, summary,
      is_reusable, origin_type, status
    ) VALUES (
      p_workspace_id, p_box_id, p_folder_id,
      p_name, p_slug, p_path_cache,
      p_source_content, v_content_bytes, p_canonical_format,
      p_description, COALESCE(p_tags, '{}'), p_summary,
      COALESCE(p_is_reusable, false), p_origin_type, 'active'
    )
    RETURNING id INTO v_object_id;

  ELSIF p_object_type = 'agent' THEN
    INSERT INTO public.agents (
      workspace_id, box_id, folder_id,
      name, slug, path_cache,
      source_content, content_bytes, canonical_format,
      agent_type, model_hint, system_prompt,
      description, tags, summary,
      is_reusable, origin_type, status
    ) VALUES (
      p_workspace_id, p_box_id, p_folder_id,
      p_name, p_slug, p_path_cache,
      p_source_content, v_content_bytes, p_canonical_format,
      p_agent_type, p_model_hint, p_system_prompt,
      p_description, COALESCE(p_tags, '{}'), p_summary,
      COALESCE(p_is_reusable, false), p_origin_type, 'active'
    )
    RETURNING id INTO v_object_id;

  ELSE
    RAISE EXCEPTION 'create_object_with_initial_version: unsupported object_type %', p_object_type;
  END IF;

  -- ── b. Insert version 1 ──────────────────────────────────────────────────
  INSERT INTO public.object_versions (
    object_type, object_id, version_number,
    source_content, content_bytes,
    actor_type, actor_id, change_origin
  ) VALUES (
    p_object_type, v_object_id, 1,
    p_source_content, v_content_bytes,
    'user', p_actor_id, 'human_edit'
  )
  RETURNING id INTO v_version_id;

  -- ── c. Set current_version_id on the owning row ──────────────────────────
  IF p_object_type = 'file' THEN
    UPDATE public.files SET current_version_id = v_version_id WHERE id = v_object_id;
    SELECT to_jsonb(f) INTO v_object_row FROM public.files   f WHERE id = v_object_id;
  ELSIF p_object_type = 'skill' THEN
    UPDATE public.skills SET current_version_id = v_version_id WHERE id = v_object_id;
    SELECT to_jsonb(s) INTO v_object_row FROM public.skills  s WHERE id = v_object_id;
  ELSIF p_object_type = 'agent' THEN
    UPDATE public.agents SET current_version_id = v_version_id WHERE id = v_object_id;
    SELECT to_jsonb(a) INTO v_object_row FROM public.agents  a WHERE id = v_object_id;
  END IF;

  SELECT to_jsonb(v) INTO v_version_row FROM public.object_versions v WHERE id = v_version_id;

  RETURN jsonb_build_object('object', v_object_row, 'version', v_version_row);
END;
$$;


-- ---------------------------------------------------------------------------
-- 3. append_initial_object_version (SMALL — version row only)
--
--    Preserves the old create_object_with_initial_version behaviour for the
--    write_proposal_service code path, which inserts the owning row itself
--    and then calls this function to attach the first version.
--
--    Atomically:
--      a. INSERTs version 1 in object_versions for the already-existing object
--      b. Updates current_version_id and content_bytes on the owning row
--
--    Called by: write_proposal_service (proposal approval for skill/agent creates).
--
--    Parameters:
--      p_object_type    — 'file' | 'skill' | 'agent'
--      p_object_id      — id of the already-inserted owning row
--      p_workspace_id   — workspace context (informational; ownership via RLS)
--      p_actor_id       — auth.users.id (uuid as text) or 'system'
--      p_source_content — full content text for version 1
--      p_actor_type     — 'user' | 'connection' | 'system'  (default 'user')
--      p_change_origin  — change_origin label  (default 'human_edit')
--
--    Returns: uuid — the new object_versions.id
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.append_initial_object_version(
  p_object_type    text,
  p_object_id      uuid,
  p_workspace_id   uuid,
  p_actor_id       text,
  p_source_content text,
  p_actor_type     text DEFAULT 'user',
  p_change_origin  text DEFAULT 'human_edit'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_version_id    uuid;
  v_content_bytes integer;
BEGIN
  v_content_bytes := octet_length(p_source_content::bytea);

  INSERT INTO public.object_versions (
    object_type, object_id, version_number,
    source_content, content_bytes,
    actor_type, actor_id, change_origin
  ) VALUES (
    p_object_type, p_object_id, 1,
    p_source_content, v_content_bytes,
    p_actor_type, p_actor_id, p_change_origin
  )
  RETURNING id INTO v_version_id;

  IF p_object_type = 'file' THEN
    UPDATE public.files
      SET current_version_id = v_version_id,
          content_bytes      = v_content_bytes
      WHERE id = p_object_id;
  ELSIF p_object_type = 'skill' THEN
    UPDATE public.skills
      SET current_version_id = v_version_id,
          content_bytes      = v_content_bytes
      WHERE id = p_object_id;
  ELSIF p_object_type = 'agent' THEN
    UPDATE public.agents
      SET current_version_id = v_version_id,
          content_bytes      = v_content_bytes
      WHERE id = p_object_id;
  END IF;

  RETURN v_version_id;
END;
$$;


-- ---------------------------------------------------------------------------
-- 4. Drop old update_object_and_create_version (returns uuid, no metadata)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.update_object_and_create_version(
  text, uuid, text, text, jsonb, text, text
);


-- ---------------------------------------------------------------------------
-- 5. update_object_and_create_version (updated — metadata + jsonb return)
--
--    Atomically:
--      a. Reads the current highest version (for parent link)
--      b. INSERTs a new version row
--      c. Updates source_content, content_bytes, metadata, and current_version_id
--         on the owning row
--      d. Returns jsonb { "object": <updated owning row>, "version": <new version> }
--
--    Called by: file_service, skill_service, agent_service, import_service.
--
--    Parameters:
--      p_object_type   — 'file' | 'skill' | 'agent'
--      p_object_id     — id of the owning row to update
--      p_source_content— updated full source text
--      p_content_bytes — byte length (computed from p_source_content if NULL)
--      p_description   — description override (NULL clears the field)
--      p_tags          — tag array (NULL keeps existing value)
--      p_summary       — summary override (NULL clears the field)
--      p_agent_type    — [agent] category hint (NULL keeps existing value)
--      p_model_hint    — [agent] preferred model (NULL keeps existing value)
--      p_system_prompt — [agent] system prompt (NULL keeps existing value)
--      p_actor_id      — auth.users.id (uuid as text) or 'system'
--      p_change_origin — change_origin label  (default 'human_edit')
--      p_diff_summary  — optional jsonb change summary
--      p_actor_type    — 'user' | 'connection' | 'system'  (default 'user')
--
--    Returns: jsonb — { "object": {...}, "version": {...} }
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_object_and_create_version(
  p_object_type    text,
  p_object_id      uuid,
  p_source_content text,
  p_content_bytes  integer     DEFAULT NULL,
  p_description    text        DEFAULT NULL,
  p_tags           text[]      DEFAULT NULL,
  p_summary        text        DEFAULT NULL,
  p_agent_type     text        DEFAULT NULL,
  p_model_hint     text        DEFAULT NULL,
  p_system_prompt  text        DEFAULT NULL,
  p_actor_id       text        DEFAULT 'system',
  p_change_origin  text        DEFAULT 'human_edit',
  p_diff_summary   jsonb       DEFAULT NULL,
  p_actor_type     text        DEFAULT 'user'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_version_id       uuid;
  v_prev_version_id  uuid;
  v_next_version_num integer;
  v_content_bytes    integer;
  v_object_row       jsonb;
  v_version_row      jsonb;
BEGIN
  v_content_bytes := COALESCE(p_content_bytes, octet_length(p_source_content::bytea));

  -- ── a. Find the current highest version for parent link ──────────────────
  SELECT id, version_number + 1
    INTO v_prev_version_id, v_next_version_num
    FROM public.object_versions
   WHERE object_type = p_object_type
     AND object_id   = p_object_id
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_next_version_num IS NULL THEN
    v_next_version_num := 1;
  END IF;

  -- ── b. Insert the new version ─────────────────────────────────────────────
  INSERT INTO public.object_versions (
    object_type, object_id, parent_version_id, version_number,
    source_content, content_bytes,
    actor_type, actor_id, change_origin, diff_summary
  ) VALUES (
    p_object_type, p_object_id, v_prev_version_id, v_next_version_num,
    p_source_content, v_content_bytes,
    p_actor_type, p_actor_id, p_change_origin, p_diff_summary
  )
  RETURNING id INTO v_version_id;

  -- ── c. Advance owning row to reflect new version + updated metadata ───────
  IF p_object_type = 'file' THEN
    UPDATE public.files
      SET current_version_id = v_version_id,
          source_content     = p_source_content,
          content_bytes      = v_content_bytes,
          description        = p_description,
          tags               = COALESCE(p_tags, tags),
          summary            = p_summary,
          updated_at         = now()
      WHERE id = p_object_id;
    SELECT to_jsonb(f) INTO v_object_row FROM public.files   f WHERE id = p_object_id;

  ELSIF p_object_type = 'skill' THEN
    UPDATE public.skills
      SET current_version_id = v_version_id,
          source_content     = p_source_content,
          content_bytes      = v_content_bytes,
          description        = p_description,
          tags               = COALESCE(p_tags, tags),
          summary            = p_summary,
          updated_at         = now()
      WHERE id = p_object_id;
    SELECT to_jsonb(s) INTO v_object_row FROM public.skills  s WHERE id = p_object_id;

  ELSIF p_object_type = 'agent' THEN
    UPDATE public.agents
      SET current_version_id = v_version_id,
          source_content     = p_source_content,
          content_bytes      = v_content_bytes,
          description        = p_description,
          tags               = COALESCE(p_tags, tags),
          summary            = p_summary,
          -- Agent-specific fields: COALESCE preserves existing value when NULL
          -- (import callers do not always supply these; agent_service always does)
          agent_type         = COALESCE(p_agent_type, agent_type),
          model_hint         = COALESCE(p_model_hint, model_hint),
          system_prompt      = COALESCE(p_system_prompt, system_prompt),
          updated_at         = now()
      WHERE id = p_object_id;
    SELECT to_jsonb(a) INTO v_object_row FROM public.agents  a WHERE id = p_object_id;

  ELSE
    RAISE EXCEPTION 'update_object_and_create_version: unsupported object_type %', p_object_type;
  END IF;

  SELECT to_jsonb(v) INTO v_version_row FROM public.object_versions v WHERE id = v_version_id;

  RETURN jsonb_build_object('object', v_object_row, 'version', v_version_row);
END;
$$;
