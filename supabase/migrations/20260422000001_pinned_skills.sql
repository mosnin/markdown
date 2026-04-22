-- Add is_default flag to box_object_attachments so workspace skills
-- can be pinned as quick-action defaults for a specific box.
--
-- is_default=true means the skill appears as a pinned quick action
-- wherever notes in that box are edited. Only one "type" of default
-- skill per box (e.g. one summarizer, one formatter) is enforced by
-- the application layer, not at the DB level.

ALTER TABLE public.box_object_attachments
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_box_object_attachments_defaults
  ON public.box_object_attachments (box_id, object_type)
  WHERE is_default = true;

COMMENT ON COLUMN public.box_object_attachments.is_default IS
  'When true, this skill/agent attachment is surfaced as a pinned quick action for all notes in the box.';
