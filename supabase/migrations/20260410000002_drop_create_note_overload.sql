-- Migration: drop the old 12-parameter overload of create_note_with_initial_version
--
-- Migration 20260409000009 added p_origin_type and p_change_origin (with DEFAULTs)
-- to create_note_with_initial_version. Because CREATE OR REPLACE with a different
-- signature creates a new overload rather than replacing the old one, both the
-- original 12-param function and the new 14-param function coexist in pg_catalog.
-- PostgreSQL cannot resolve which overload to use when called with 12 named args
-- (both match), producing the error:
--   "Could not choose the best candidate function between: ..."
--
-- Fix: drop the old 12-param overload. The 14-param version handles all existing
-- call-sites because p_origin_type and p_change_origin have DEFAULT values.

DROP FUNCTION IF EXISTS public.create_note_with_initial_version(
  uuid,       -- p_box_id
  uuid,       -- p_folder_id
  text,       -- p_title
  text,       -- p_slug
  text,       -- p_path_cache
  text,       -- p_markdown_content
  text,       -- p_summary
  text[],     -- p_tags
  text,       -- p_read_hint
  integer,    -- p_retrieval_priority
  text,       -- p_kind
  text        -- p_actor_id
);
