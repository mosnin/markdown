-- WebAuthn / passkey credentials for passwordless authentication.
-- Each row stores the public-key material needed to verify a passkey
-- assertion, plus bookkeeping fields for the settings UI.

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id       text NOT NULL UNIQUE,
  public_key          bytea NOT NULL,
  counter             bigint NOT NULL DEFAULT 0,
  transports          text[],
  device_name         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz
);

CREATE INDEX ON webauthn_credentials (user_id);

-- Challenges are ephemeral; stored server-side so they cannot be
-- replayed. A cron or application-level cleanup should purge expired
-- rows periodically.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge   text NOT NULL UNIQUE,
  type        text NOT NULL CHECK (type IN ('registration', 'authentication')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '5 minutes'
);

CREATE INDEX ON webauthn_challenges (challenge);
CREATE INDEX ON webauthn_challenges (expires_at);
