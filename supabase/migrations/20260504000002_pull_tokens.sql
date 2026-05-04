-- =============================================================================
-- Pull tokens — short-lived "Send to AI" links
-- Migration: 20260504000002_pull_tokens.sql
--
-- A pull-token is a one-shot or short-lived URL that lets an external AI agent
-- redeem a single object (today: a note) and receive a content-negotiated
-- context bundle. Tokens are workspace + user scoped, opaque to the recipient,
-- and stored only as a SHA-256 hash. The raw token is returned to the issuer
-- exactly once at creation time.
--
-- Each redemption optionally slides the expiry forward (sliding_window_seconds)
-- but never past the hard cap (hard_cap_at). max_redemptions provides an
-- absolute ceiling that revokes the token once exhausted.
--
-- RLS: token rows are owner-readable / owner-revoke-only. Issue, redeem, and
-- audit operations all run via the service role, which bypasses RLS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
CREATE TABLE public.pull_tokens (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id                  uuid        NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  token_hash               text        NOT NULL UNIQUE,
  token_prefix             text        NOT NULL,
  object_type              text        NOT NULL CHECK (object_type IN ('note','box','skill','agent','bundle')),
  object_id                uuid        NOT NULL,
  write_capable            boolean     NOT NULL DEFAULT false,
  expires_at               timestamptz NOT NULL,
  hard_cap_at              timestamptz NOT NULL,
  sliding_window_seconds   int         NOT NULL DEFAULT 0,
  max_redemptions          int         NOT NULL DEFAULT 100,
  redemption_count         int         NOT NULL DEFAULT 0,
  last_redeemed_at         timestamptz,
  last_user_agent          text,
  revoked_at               timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (max_redemptions > 0 AND max_redemptions <= 10000),
  CHECK (sliding_window_seconds >= 0 AND sliding_window_seconds <= 86400)
);

CREATE INDEX idx_pull_tokens_workspace_user ON public.pull_tokens (workspace_id, user_id);
CREATE INDEX idx_pull_tokens_hash           ON public.pull_tokens (token_hash);

-- ---------------------------------------------------------------------------
-- 2. RLS — owner read / owner revoke only; service role writes everything
-- ---------------------------------------------------------------------------
ALTER TABLE public.pull_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY pull_tokens_owner_read
  ON public.pull_tokens
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY pull_tokens_owner_revoke
  ON public.pull_tokens
  FOR UPDATE
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Atomic redemption RPC
--
-- Looks up a row by token_hash, validates it, then atomically:
--   * increments redemption_count
--   * stamps last_redeemed_at and last_user_agent
--   * slides expires_at forward (clamped to hard_cap_at)
--
-- Returns the redeemed metadata or NULL on any failure
-- (revoked, expired, hash unknown, redemption ceiling reached).
--
-- The function is SECURITY DEFINER so the service role can call it without
-- any RLS interference. Application code must validate the result is non-null.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_pull_token(
  p_token_hash text,
  p_user_agent text
)
RETURNS TABLE (
  workspace_id    uuid,
  user_id         uuid,
  object_type     text,
  object_id       uuid,
  write_capable   boolean,
  new_expires_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.pull_tokens%ROWTYPE;
  v_new_expires timestamptz;
BEGIN
  -- Lock the row for update so concurrent redemptions don't race the count.
  SELECT *
    INTO v_row
    FROM public.pull_tokens
   WHERE token_hash = p_token_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_row.revoked_at IS NOT NULL THEN
    RETURN;
  END IF;

  IF v_row.expires_at <= now() THEN
    RETURN;
  END IF;

  IF v_row.redemption_count >= v_row.max_redemptions THEN
    RETURN;
  END IF;

  -- Compute the new expiry. Slide forward by sliding_window_seconds, but never
  -- below the existing expiry (so a rapid burst doesn't shrink the window) and
  -- never past hard_cap_at.
  IF v_row.sliding_window_seconds > 0 THEN
    v_new_expires := LEAST(
      v_row.hard_cap_at,
      GREATEST(
        v_row.expires_at,
        now() + make_interval(secs => v_row.sliding_window_seconds)
      )
    );
  ELSE
    v_new_expires := v_row.expires_at;
  END IF;

  UPDATE public.pull_tokens
     SET redemption_count = v_row.redemption_count + 1,
         last_redeemed_at = now(),
         last_user_agent  = p_user_agent,
         expires_at       = v_new_expires
   WHERE id = v_row.id;

  workspace_id   := v_row.workspace_id;
  user_id        := v_row.user_id;
  object_type    := v_row.object_type;
  object_id      := v_row.object_id;
  write_capable  := v_row.write_capable;
  new_expires_at := v_new_expires;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_pull_token(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.redeem_pull_token(text, text) TO service_role;
