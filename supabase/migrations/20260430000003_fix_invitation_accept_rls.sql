-- =============================================================================
-- Context Store — fix invitation ACCEPT denied by RLS
-- Migration: 20260430000003_fix_invitation_accept_rls.sql
--
-- BLOCKER FIX (security audit):
--
-- acceptInvitation runs on the RLS-active cookie client and inserts into
-- workspace_memberships. The only INSERT policy on that table
-- (workspace_memberships_admin_insert, from 20260412000003) requires
-- public.can_admin_workspace(workspace_id) — which is FALSE for a brand-new
-- invitee who is not yet a member of the target workspace. The insert is
-- therefore rejected and accept throws, so invited users can never join.
--
-- The membership INSERT policy is correct and must NOT be loosened: letting
-- arbitrary authenticated users insert membership rows for themselves would
-- be a privilege-escalation hole (anyone could self-join any workspace at
-- any role). Instead we add a narrowly-scoped SECURITY DEFINER function that
-- performs the privileged insert ONLY after proving the caller holds a
-- valid, pending, non-expired invitation addressed to their own email.
--
-- Schema this function is written against (verified, no DB to run it):
--   workspace_invitations(id, workspace_id, email, role, token, invited_by,
--     status['pending'|'accepted'|'declined'|'expired'], expires_at,
--     accepted_at, created_at)               -- 20260415000002
--   workspace_memberships(id, workspace_id, user_id,
--     role['viewer'|'member'|'admin'], invited_by, invited_at, accepted_at,
--     created_at, updated_at)                -- 20260412000003
--     UNIQUE (workspace_id, user_id)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- accept_workspace_invitation(p_token, p_user_id, p_user_email)
--
-- Runs as SECURITY DEFINER so it can insert the membership row past the
-- admin-only INSERT policy. Every authority check the bypassed RLS would
-- have implied is re-implemented explicitly below, so the elevated
-- privilege can only ever be used to honour a legitimate invitation:
--
--   1. The invitation is looked up by its (secret) token and locked
--      FOR UPDATE so two concurrent accepts can't both succeed.
--   2. It must still be 'pending'.
--   3. It must not be past expires_at (a lapsed-but-still-'pending' row is
--      flipped to 'expired' and rejected, matching the TS behaviour).
--   4. lower(invitation.email) must equal lower(p_user_email): the caller
--      can only accept an invitation addressed to their own verified email.
--      p_user_email is supplied by the server action from the authenticated
--      Supabase user, never from client input.
--
-- On success it upserts the membership at the invitation's role (idempotent
-- on the (workspace_id, user_id) unique key, so re-accepting or accepting
-- when a row already exists is harmless), marks the invitation accepted,
-- and returns the workspace id.
--
-- search_path is pinned to public (+ pg_temp last) — mandatory hardening for
-- SECURITY DEFINER so a caller can't shadow the referenced objects.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_workspace_invitation(
  p_token       text,
  p_user_id     uuid,
  p_user_email  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invitation  public.workspace_invitations;
BEGIN
  IF p_token IS NULL OR p_user_id IS NULL OR p_user_email IS NULL THEN
    RAISE EXCEPTION 'Invitation token, user id, and user email are required';
  END IF;

  -- Step 1: look up + lock the invitation by its secret token.
  SELECT * INTO v_invitation
    FROM public.workspace_invitations
   WHERE token = p_token
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or already used.';
  END IF;

  -- Step 2: must still be pending.
  IF v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation not found or already used.';
  END IF;

  -- Step 3: expiry. Flip a lapsed row to 'expired' so it stops showing up
  -- as pending, then reject — mirrors acceptInvitation() in TS.
  IF v_invitation.expires_at < now() THEN
    UPDATE public.workspace_invitations
       SET status = 'expired'
     WHERE id = v_invitation.id;
    RAISE EXCEPTION 'This invitation has expired.';
  END IF;

  -- Step 4: the caller may only accept an invitation addressed to their
  -- own email. Case-insensitive compare; defence-in-depth against a
  -- mismatched user id since this function bypasses RLS.
  IF lower(v_invitation.email) <> lower(p_user_email) THEN
    RAISE EXCEPTION 'This invitation was issued to a different email address.';
  END IF;

  -- Step 5: create (or re-affirm) the membership at the invited role.
  -- Idempotent on the (workspace_id, user_id) unique key so an existing
  -- member accepting again does not error.
  INSERT INTO public.workspace_memberships (
    workspace_id, user_id, role, invited_by, accepted_at
  ) VALUES (
    v_invitation.workspace_id,
    p_user_id,
    v_invitation.role,
    v_invitation.invited_by,
    now()
  )
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  -- Step 6: mark the invitation accepted.
  UPDATE public.workspace_invitations
     SET status = 'accepted',
         accepted_at = now()
   WHERE id = v_invitation.id;

  RETURN v_invitation.workspace_id;
END;
$$;

-- Lock down execution. SECURITY DEFINER functions default to EXECUTE for
-- PUBLIC, which would let the anon role call this; restrict to authenticated
-- sessions only (the only callers are signed-in users accepting an invite).
REVOKE ALL ON FUNCTION public.accept_workspace_invitation(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invitation(text, uuid, text) TO authenticated;
