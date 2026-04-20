-- =============================================================================
-- Operator: saved prompts + REST API keys.
-- Migration: 20260420000002_operator_artifacts_and_prompts.sql
--
-- Two unrelated-but-paired tables that ship together for Wave 1 Agent G:
--
--   1. workspace_operator_prompts — per-(workspace, user) library of named
--      prompt templates the user can re-run. The `(workspace_id, user_id,
--      name)` UNIQUE constraint lets the user pin "weekly summary" once per
--      workspace without colliding with another teammate's pin in the same
--      workspace. Prompts are private to the author — RLS is per-user, not
--      per-workspace, even though we partition by workspace for tidiness.
--
--   2. operator_api_keys — bearer tokens scoped to a specific (user,
--      workspace) pair. `key_hash` stores sha256(raw_key); the raw key is
--      shown to the user exactly once at creation time. `key_prefix` (first
--      12 chars of the raw key) is stored for display in the management UI
--      and as a hint in audit logs. Mirrors the connection_tokens /
--      oauth_access_tokens pattern.
--
-- The artifacts read-side does NOT add a table — workspace_operator_runs
-- already carries `notes_created uuid[]`, which is the canonical artifact
-- list per run. The artifacts service joins that array against `notes` at
-- read time. See src/server/services/operator_artifacts_service.ts.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. workspace_operator_prompts
-- ---------------------------------------------------------------------------

CREATE TABLE public.workspace_operator_prompts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  prompt        text NOT NULL CHECK (length(prompt) BETWEEN 1 AND 4000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, name)
);

CREATE INDEX workspace_operator_prompts_user_idx
  ON public.workspace_operator_prompts (user_id, workspace_id, updated_at DESC);

CREATE TRIGGER workspace_operator_prompts_set_updated_at
  BEFORE UPDATE ON public.workspace_operator_prompts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.workspace_operator_prompts ENABLE ROW LEVEL SECURITY;

-- Strictly self-only, per the user_agent_preferences pattern in
-- 20260419000002. A teammate sharing a workspace cannot read another
-- teammate's saved prompts; sharing requires a future "shared prompts"
-- feature with explicit publication.
CREATE POLICY workspace_operator_prompts_self_select
  ON public.workspace_operator_prompts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY workspace_operator_prompts_self_insert
  ON public.workspace_operator_prompts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.owns_workspace(workspace_id)
  );

CREATE POLICY workspace_operator_prompts_self_update
  ON public.workspace_operator_prompts
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY workspace_operator_prompts_self_delete
  ON public.workspace_operator_prompts
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. operator_api_keys
-- ---------------------------------------------------------------------------

CREATE TABLE public.operator_api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- First 12 chars of the raw key (e.g. `wopr_abcd1234`), shown in
  -- the keys-management UI so the user can disambiguate without
  -- recovering the secret.
  key_prefix    text NOT NULL,
  -- sha256(raw_key) hex digest. UNIQUE so verification is a O(1)
  -- index lookup; the prefix alone is not unique because two keys
  -- could share the first 12 chars on a hash collision (vanishingly
  -- small but the constraint is on the hash for safety).
  key_hash      text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NULL,
  revoked_at    timestamptz NULL
);

CREATE INDEX operator_api_keys_user_idx
  ON public.operator_api_keys (user_id, created_at DESC);
CREATE INDEX operator_api_keys_workspace_idx
  ON public.operator_api_keys (workspace_id, created_at DESC);

ALTER TABLE public.operator_api_keys ENABLE ROW LEVEL SECURITY;

-- The user can list / revoke their own keys via the cookie session.
-- Verification on the bearer-auth path uses the admin client (see
-- src/server/services/operator_api_keys_service.ts) so RLS is bypassed
-- there — that's by design; the API key IS the auth artifact.
CREATE POLICY operator_api_keys_self_select
  ON public.operator_api_keys
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY operator_api_keys_self_insert
  ON public.operator_api_keys
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.owns_workspace(workspace_id)
  );

CREATE POLICY operator_api_keys_self_update
  ON public.operator_api_keys
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY operator_api_keys_self_delete
  ON public.operator_api_keys
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
