-- Expand skill/agent canonical formats to support non-markdown canonical sources.
-- This keeps one canonical editable source per object while allowing richer formats.

ALTER TABLE public.skills
  DROP CONSTRAINT IF EXISTS skills_canonical_format_check;

ALTER TABLE public.skills
  ADD CONSTRAINT skills_canonical_format_check
  CHECK (canonical_format IN (
    'markdown',
    'json',
    'yaml',
    'xml',
    'python',
    'typescript',
    'javascript',
    'shell',
    'plain_text'
  ));

ALTER TABLE public.agents
  DROP CONSTRAINT IF EXISTS agents_canonical_format_check;

ALTER TABLE public.agents
  ADD CONSTRAINT agents_canonical_format_check
  CHECK (canonical_format IN (
    'markdown',
    'json',
    'yaml',
    'xml',
    'python',
    'typescript',
    'javascript',
    'shell',
    'plain_text'
  ));
