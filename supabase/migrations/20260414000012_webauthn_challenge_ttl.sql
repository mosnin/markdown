-- WebAuthn challenge TTL enforcement
--
-- The webauthn_challenges table already has an `expires_at` column
-- (defaulting to now() + 5 minutes) and an index on `expires_at`.
-- This migration adds:
--   1. An index on (user_id, created_at) for efficient cleanup queries
--   2. A cleanup function to purge expired rows
--   3. An initial run of the cleanup function

-- 1. Index for cleanup and lookup queries
CREATE INDEX IF NOT EXISTS webauthn_challenges_user_created_idx
  ON webauthn_challenges (user_id, created_at);

-- 2. Cleanup function: deletes all expired challenges
CREATE OR REPLACE FUNCTION cleanup_expired_webauthn_challenges()
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM webauthn_challenges WHERE expires_at < now();
$$;

-- 3. Run cleanup once to clear any stale rows
SELECT cleanup_expired_webauthn_challenges();
