-- =============================================================================
-- Context Store — atomic write-proposal paywall enforcement
-- Migration: 20260501000002_proposal_quota_atomic.sql
--
-- BUG (P2, TOCTOU): the write-proposal paywall was check-then-insert.
--   `checkProposalQuota` did a COUNT(*) of write_proposals for the period and
--   the caller then inserted (write_proposal_repository / the
--   create_generated_note_with_version RPC). N concurrent requests issued at
--   used == limit-1 all read used < limit and all insert, so a workspace could
--   exceed its per-period cap by the number of in-flight requests
--   (free = 20, pro = 1000). This is the revenue paywall.
--
-- FIX (make enforcement atomic per workspace): serialize concurrent writers
--   for a workspace using a Postgres TRANSACTION advisory lock
--   (`pg_advisory_xact_lock`) keyed on the workspace, taken INSIDE the same
--   transaction that counts the period usage and performs the insert. Because
--   `pg_advisory_xact_lock` blocks until the lock is acquired and is released
--   automatically at transaction end, the count-then-insert becomes
--   effectively serialized per workspace: each writer sees the committed
--   effect of the previous one's insert, so the cap holds exactly.
--
--   The lock key is `hashtext('proposal_quota:' || workspace_id)`. The string
--   prefix namespaces the key so it cannot collide with advisory locks taken
--   for other purposes elsewhere. Both write paths use the SAME key so write
--   proposals and generated notes — which share the one per-period meter —
--   serialize against each other.
--
-- Two objects:
--   1. CREATE OR REPLACE create_generated_note_with_version — adds a quota
--      limit + period-start parameter, takes the advisory lock, counts period
--      usage, and signals quota-exceeded WITHOUT inserting when the workspace
--      is at/over its cap. Existing insert/return behavior is otherwise
--      preserved.
--   2. CREATE create_write_proposal_guarded — a guarded insert for
--      write_proposals: takes the advisory lock, counts period usage, and
--      inserts only when under the cap, returning the new row or a
--      quota-exceeded signal.
--
-- Both are called via the admin (service-role) client (bypasses RLS) and use
-- SECURITY INVOKER. The service layer still performs all workspace / box /
-- folder / permission-mode checks BEFORE calling these functions; the only new
-- responsibility moved into SQL is the atomic quota gate.
--
-- Quota-exceeded signal shape (jsonb), distinguishable from a success result:
--   { "quota_exceeded": true, "limit": <int>, "used": <int> }
-- A success result keeps its existing shape and never carries that key.
--
-- This migration does NOT edit already-applied migrations. It only uses
-- CREATE OR REPLACE (for the existing function) / CREATE (for the new one).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. create_generated_note_with_version (atomic quota gate added)
--
-- New trailing parameters (defaulted so any positional caller that omits them
-- keeps the prior, ungated behavior — though the service always passes them):
--   p_quota_limit   integer     — per-period write cap for the workspace tier.
--                                 NULL disables the gate (unlimited).
--   p_period_start  timestamptz — first instant of the current billing period;
--                                 usage is COUNT(write_proposals) created at or
--                                 after this instant for the workspace.
--
-- The workspace id needed for the lock + count is derived from the folder's
-- box (boxes.workspace_id) so no new identity parameter is required and the
-- count matches checkProposalQuota's per-workspace bucket exactly.
--
-- Returns jsonb:
--   { note: {...}, version: {...} }                       (created, as before)
--   { quota_exceeded: true, limit: <int>, used: <int> }   (nothing inserted)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_generated_note_with_version(
  p_box_id              uuid,
  p_folder_id           uuid,
  p_title               text,
  p_slug                text,
  p_path_cache          text,
  p_markdown_content    text,
  p_summary             text,
  p_tags                text[],
  p_read_hint           text,
  p_retrieval_priority  integer,
  p_connection_id       uuid,
  p_quota_limit         integer     DEFAULT NULL,
  p_period_start        timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_note         notes;
  v_version      note_versions;
  v_bytes        integer;
  v_workspace_id uuid;
  v_used         integer;
BEGIN
  -- Resolve the owning workspace from the box. This is the key for both the
  -- advisory lock and the per-period usage count, keeping it consistent with
  -- checkProposalQuota's per-workspace bucket.
  SELECT workspace_id INTO v_workspace_id
    FROM boxes
   WHERE id = p_box_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Box % not found', p_box_id;
  END IF;

  -- ── Atomic paywall gate ───────────────────────────────────────────────────
  -- Take the per-workspace transaction advisory lock BEFORE counting so any
  -- concurrent writer for this workspace serializes behind us and sees our
  -- committed insert. Released automatically at transaction end.
  IF p_quota_limit IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('proposal_quota:' || v_workspace_id::text));

    SELECT count(*) INTO v_used
      FROM write_proposals
     WHERE workspace_id = v_workspace_id
       AND created_at >= COALESCE(p_period_start, '-infinity'::timestamptz);

    IF v_used >= p_quota_limit THEN
      -- Over cap: signal quota-exceeded and insert NOTHING.
      RETURN jsonb_build_object(
        'quota_exceeded', true,
        'limit',          p_quota_limit,
        'used',           v_used
      );
    END IF;
  END IF;

  v_bytes := octet_length(p_markdown_content);

  -- Insert the note
  INSERT INTO notes (
    box_id, folder_id, title, slug, path_cache,
    markdown_content, content_bytes,
    summary, tags, read_hint, retrieval_priority, kind,
    status, origin_type, is_generated, generated_by_connection_id
  ) VALUES (
    p_box_id,
    p_folder_id,
    p_title,
    p_slug,
    p_path_cache,
    p_markdown_content,
    v_bytes,
    p_summary,
    COALESCE(p_tags, '{}'),
    p_read_hint,
    COALESCE(p_retrieval_priority, 0),
    'note',
    'active',
    'generated',
    true,
    p_connection_id
  )
  RETURNING * INTO v_note;

  -- Insert initial version
  INSERT INTO note_versions (
    note_id, parent_version_id, version_number,
    title, markdown_content, content_bytes,
    actor_type, actor_id, change_origin
  ) VALUES (
    v_note.id,
    NULL,
    1,
    v_note.title,
    v_note.markdown_content,
    v_note.content_bytes,
    'connection',
    p_connection_id::text,
    'generated'
  )
  RETURNING * INTO v_version;

  -- Link note to initial version
  UPDATE notes
  SET current_version_id = v_version.id
  WHERE id = v_note.id
  RETURNING * INTO v_note;

  RETURN jsonb_build_object(
    'note',    to_jsonb(v_note),
    'version', to_jsonb(v_version)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. create_write_proposal_guarded
--
-- Atomic, quota-gated insert for write_proposals. Replaces the previous
-- check-then-insert (checkProposalQuota in the service + a plain repository
-- INSERT) with a single transaction that:
--   1. Takes the per-workspace advisory lock (same key as generated notes).
--   2. Counts period usage for the workspace.
--   3. Inserts the proposal ONLY when under the cap, else signals exceeded.
--
-- The proposal column values are supplied as a single jsonb object
-- (p_proposal) so the column set stays in lockstep with
-- write_proposal_repository.CreateWriteProposalInput without a wide parameter
-- list. Only known columns are read out of the jsonb; everything else uses the
-- table defaults (id, status='pending', timestamps). The inserted row is
-- returned as jsonb via to_jsonb(row), matching the repository's prior
-- `.select().single()` (full-row) shape.
--
-- p_quota_limit / p_period_start mirror create_generated_note_with_version.
-- p_quota_limit NULL disables the gate (insert always proceeds).
--
-- Returns jsonb:
--   { proposal: {<full write_proposals row>} }            (created)
--   { quota_exceeded: true, limit: <int>, used: <int> }   (nothing inserted)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_write_proposal_guarded(
  p_workspace_id  uuid,
  p_proposal      jsonb,
  p_quota_limit   integer     DEFAULT NULL,
  p_period_start  timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_used      integer;
  v_proposal  write_proposals;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'create_write_proposal_guarded requires a workspace id';
  END IF;

  -- ── Atomic paywall gate ───────────────────────────────────────────────────
  -- Lock first, then count, then insert — all in one transaction — so
  -- concurrent writers for this workspace serialize and the cap holds exactly.
  IF p_quota_limit IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('proposal_quota:' || p_workspace_id::text));

    SELECT count(*) INTO v_used
      FROM write_proposals
     WHERE workspace_id = p_workspace_id
       AND created_at >= COALESCE(p_period_start, '-infinity'::timestamptz);

    IF v_used >= p_quota_limit THEN
      RETURN jsonb_build_object(
        'quota_exceeded', true,
        'limit',          p_quota_limit,
        'used',           v_used
      );
    END IF;
  END IF;

  -- Insert the proposal. workspace_id is taken from the trusted parameter (the
  -- same id the gate counted/locked on); all other columns come from the jsonb
  -- payload, with unset keys falling back to table defaults.
  INSERT INTO write_proposals (
    workspace_id,
    connection_id,
    proposal_type,
    target_note_id,
    target_version_id,
    proposed_folder_id,
    target_object_type,
    target_object_id,
    target_object_version_id,
    proposed_title,
    proposed_content,
    proposed_summary,
    proposed_tags,
    rationale,
    expires_at
  ) VALUES (
    p_workspace_id,
    (p_proposal ->> 'connection_id')::uuid,
    p_proposal ->> 'proposal_type',
    (p_proposal ->> 'target_note_id')::uuid,
    (p_proposal ->> 'target_version_id')::uuid,
    (p_proposal ->> 'proposed_folder_id')::uuid,
    p_proposal ->> 'target_object_type',
    (p_proposal ->> 'target_object_id')::uuid,
    (p_proposal ->> 'target_object_version_id')::uuid,
    p_proposal ->> 'proposed_title',
    p_proposal ->> 'proposed_content',
    p_proposal ->> 'proposed_summary',
    CASE
      WHEN p_proposal ? 'proposed_tags'
           AND jsonb_typeof(p_proposal -> 'proposed_tags') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_proposal -> 'proposed_tags'))
      ELSE NULL
    END,
    p_proposal ->> 'rationale',
    (p_proposal ->> 'expires_at')::timestamptz
  )
  RETURNING * INTO v_proposal;

  RETURN jsonb_build_object('proposal', to_jsonb(v_proposal));
END;
$$;
