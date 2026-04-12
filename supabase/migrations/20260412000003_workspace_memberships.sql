-- =============================================================================
-- Context Store — multi-user workspace access
-- Migration: 20260412000003_workspace_memberships.sql
--
-- Up to this point workspaces had a single owner (workspaces.owner_id) and
-- every child-table RLS policy keyed access to auth.uid() == owner_id via
-- the public.owns_workspace(uuid) function. This migration introduces
-- three-role workspace membership (viewer / member / admin) while
-- preserving the existing ownership contract:
--
--   * workspaces.owner_id continues to exist and continues to be the
--     ultimate authority for workspace deletion and ownership transfer.
--   * Every existing owner is backfilled as an admin member of their own
--     workspaces so no legacy RLS check changes behaviour for them.
--   * owns_workspace(wid) is redefined to return true for *any* membership
--     — that is, any of the three roles gives the user row-level access to
--     the workspace and its children. Write-role restriction (viewers may
--     not edit) is enforced at the service / server-action layer, not the
--     RLS layer, so we don't have to rewrite ~90 policies in this
--     migration. The service layer already funnels every content mutation
--     through a small number of server actions where the role check is
--     unambiguous.
--   * workspace_role(wid) and can_write_workspace(wid) helpers are added
--     for application code and for any future RLS tightening.
--   * audit_events gains a workspace.member.* event family via the
--     existing string-typed event_type column (no schema change).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. workspace_memberships table
--
--    One row per (workspace, user). Unique so a user cannot have two roles
--    in the same workspace. invited_by + invited_at make the membership
--    auditable at the row level. accepted_at is nullable to support an
--    invitation flow where the invited user must accept before the
--    membership becomes active; the V1 flow accepts immediately (admin
--    adds an existing auth user directly) and sets accepted_at = now().
-- ---------------------------------------------------------------------------

CREATE TABLE public.workspace_memberships (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          text        NOT NULL
                            CHECK (role IN ('viewer', 'member', 'admin')),
  invited_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, user_id)
);

CREATE INDEX workspace_memberships_workspace_id_idx
  ON public.workspace_memberships (workspace_id);
CREATE INDEX workspace_memberships_user_id_idx
  ON public.workspace_memberships (user_id);

CREATE TRIGGER workspace_memberships_set_updated_at
  BEFORE UPDATE ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Backfill: every existing workspace owner becomes an admin member.
--
--    ON CONFLICT DO NOTHING makes this idempotent; re-running it after
--    admins manually adjust roles doesn't clobber their work.
-- ---------------------------------------------------------------------------

INSERT INTO public.workspace_memberships (
  workspace_id, user_id, role, invited_by, invited_at, accepted_at
)
SELECT
  w.id, w.owner_id, 'admin', w.owner_id, w.created_at, w.created_at
FROM public.workspaces w
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Redefine owns_workspace(wid)
--
--    Expanded from "is owner" to "is member in any role". All existing RLS
--    policies that use owns_workspace now grant access to every role.
--    Write-role restriction lives in the application layer (see
--    src/server/auth/require_* helpers and action-level role guards).
--
--    SECURITY DEFINER is kept so the function can read
--    workspace_memberships when called from within a child-table RLS
--    policy. search_path is pinned to public for the usual reason.
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
    FROM public.workspace_memberships m
    WHERE m.workspace_id = wid
      AND m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. workspace_role(wid) — returns the caller's role text, or NULL if not
--    a member. 'owner' is returned for the workspace.owner_id even though
--    the backfill gave them 'admin' membership, so application code can
--    distinguish the canonical owner from other admins.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.workspace_role(wid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = wid AND w.owner_id = auth.uid()
    ) THEN 'owner'
    ELSE (
      SELECT m.role FROM public.workspace_memberships m
      WHERE m.workspace_id = wid AND m.user_id = auth.uid()
      LIMIT 1
    )
  END;
$$;

-- ---------------------------------------------------------------------------
-- 5. can_write_workspace(wid) — true for member or admin (or owner).
--    Exposed for possible future RLS use and for boundary checks in
--    Postgres functions.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_write_workspace(wid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.workspace_role(wid) IN ('owner', 'admin', 'member');
$$;

-- ---------------------------------------------------------------------------
-- 6. can_admin_workspace(wid) — true for admins and the owner. Gates
--    membership management.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_admin_workspace(wid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.workspace_role(wid) IN ('owner', 'admin');
$$;

-- ---------------------------------------------------------------------------
-- 7. RLS for workspace_memberships itself.
--
--    * A user can always read their own membership rows (so they know
--      which workspaces they belong to without needing a round trip
--      through the workspaces table).
--    * Admins can read every membership row for workspaces they admin.
--    * Only admins can INSERT / UPDATE / DELETE — enforcement of role
--      changes lives here and in the matching service layer.
-- ---------------------------------------------------------------------------

ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_memberships_self_select
  ON public.workspace_memberships
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY workspace_memberships_admin_select
  ON public.workspace_memberships
  FOR SELECT
  TO authenticated
  USING (public.can_admin_workspace(workspace_id));

CREATE POLICY workspace_memberships_admin_insert
  ON public.workspace_memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_admin_workspace(workspace_id));

CREATE POLICY workspace_memberships_admin_update
  ON public.workspace_memberships
  FOR UPDATE
  TO authenticated
  USING (public.can_admin_workspace(workspace_id))
  WITH CHECK (public.can_admin_workspace(workspace_id));

CREATE POLICY workspace_memberships_admin_delete
  ON public.workspace_memberships
  FOR DELETE
  TO authenticated
  USING (public.can_admin_workspace(workspace_id));
