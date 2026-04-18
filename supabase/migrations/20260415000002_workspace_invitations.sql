-- =============================================================================
-- Context Store — workspace invitations for multi-user teams
-- Migration: 20260415000002_workspace_invitations.sql
--
-- Adds a durable invitation table so admins can invite users by email
-- before they sign up. Invitations carry a unique token, expire after
-- 7 days, and can be accepted, declined, or revoked.
--
-- The workspace_memberships table (from 20260412000003) is the target
-- for accepted invitations — acceptInvitation creates a membership row.
-- =============================================================================

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('viewer', 'member', 'admin')),
  token text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email, status)
);

-- Partial indexes for common query patterns.
CREATE INDEX ON workspace_invitations (token) WHERE status = 'pending';
CREATE INDEX ON workspace_invitations (email) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- RLS — workspace_invitations
--
-- * Admins can read/write invitations for workspaces they admin.
-- * Any authenticated user can read invitations addressed to their email
--   (so the accept/decline page works).
-- ---------------------------------------------------------------------------

ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_invitations_admin_select
  ON workspace_invitations
  FOR SELECT
  TO authenticated
  USING (public.can_admin_workspace(workspace_id));

CREATE POLICY workspace_invitations_user_select
  ON workspace_invitations
  FOR SELECT
  TO authenticated
  USING (
    email = (SELECT auth.jwt() ->> 'email')
    AND status = 'pending'
  );

CREATE POLICY workspace_invitations_admin_insert
  ON workspace_invitations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_admin_workspace(workspace_id));

CREATE POLICY workspace_invitations_admin_update
  ON workspace_invitations
  FOR UPDATE
  TO authenticated
  USING (public.can_admin_workspace(workspace_id));

-- Allow the invited user to update (accept/decline) their own invitation
CREATE POLICY workspace_invitations_user_update
  ON workspace_invitations
  FOR UPDATE
  TO authenticated
  USING (
    email = (SELECT auth.jwt() ->> 'email')
    AND status = 'pending'
  );

CREATE POLICY workspace_invitations_admin_delete
  ON workspace_invitations
  FOR DELETE
  TO authenticated
  USING (public.can_admin_workspace(workspace_id));
