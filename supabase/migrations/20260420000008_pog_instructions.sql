-- Pog Agent: per-box and per-workspace instructions
--
-- These free-form text columns hold instructions the user wants Pog to
-- follow when it runs inside a particular box or workspace. Examples:
--   - "Always cite sources."
--   - "Use British English."
--   - "Prefer tables over bullet lists."
--
-- The operator.py agent fetches them at run start and appends them to
-- the system prompt so every Pog run in that context inherits the
-- rules without the user having to retype them.
--
-- Both columns are nullable — absence means "no extra instructions."

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS agent_instructions text;

ALTER TABLE boxes
  ADD COLUMN IF NOT EXISTS agent_instructions text;

COMMENT ON COLUMN workspaces.agent_instructions IS
  'Free-form instructions automatically injected into every Pog run in this workspace.';

COMMENT ON COLUMN boxes.agent_instructions IS
  'Free-form instructions automatically injected into Pog runs scoped to this box.';
