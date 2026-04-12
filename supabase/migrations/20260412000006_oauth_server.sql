-- =============================================================================
-- Context Store — OAuth 2.1 + PKCE server foundation
-- Migration: 20260412000006_oauth_server.sql
--
-- Puts in place the durable tables needed to act as an OAuth 2.1
-- authorization server so third-party connectors (Claude Desktop,
-- OpenAI apps, custom integrations) can obtain user-scoped access to
-- the MCP adapter without ever handling a long-lived bearer secret
-- through unsafe channels (env vars, URLs, pasted strings).
--
-- Design notes:
--
-- * Authorization code flow with PKCE is the only supported flow for
--   third-party clients. Client credentials flow is intentionally NOT
--   implemented — every MCP session is anchored to a specific human
--   user so audit attribution stays honest.
-- * Access tokens are opaque 32-byte strings (not JWTs). We store a
--   `token_prefix` for O(1) lookup and a SHA-256 hash for constant-time
--   comparison — identical to the existing connection_tokens pattern.
-- * Refresh tokens are rotated on every use (RFC 6749 §6 recommendation
--   + OAuth 2.1 requirement). The previous refresh token is revoked on
--   refresh; reusing a revoked refresh token revokes the entire token
--   family as a defense against token theft.
-- * Consents persist the user's "Approve" decision per (user, client,
--   workspace, scopes) so subsequent connector re-auths for the same
--   scopes skip the consent screen. Revoking consent invalidates every
--   access/refresh token issued under it.
-- * RLS on every new table — clients are readable by any authenticated
--   user (so the connector discovery metadata works), but tokens and
--   consents are only readable by the owning user.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. oauth_clients
--
--   Every connector (first-party or third-party) has a row here. Public
--   (native) clients cannot safely hold a secret and must use PKCE; the
--   `is_confidential` boolean distinguishes confidential clients that
--   DO hold a secret (server-to-server integrations).
-- ---------------------------------------------------------------------------

CREATE TABLE public.oauth_clients (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Public client identifier. Stable per registration; shown in the
  -- consent UI and in the token endpoint's client_id parameter.
  client_id           text        NOT NULL UNIQUE
                                  CHECK (client_id ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),

  -- SHA-256 hash of the client secret (confidential clients only).
  -- NULL for public clients. Secret is shown once at client creation
  -- and never stored in plaintext — identical to the existing
  -- connection_tokens pattern.
  client_secret_hash  text,

  name                text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description         text,
  homepage_url        text,
  logo_url            text,

  -- Exact-match redirect URIs. Wildcards are NOT allowed — the
  -- authorize endpoint compares character-for-character. `urn:ietf:wg:
  -- oauth:2.0:oob` is accepted for CLI / headless flows.
  redirect_uris       text[]      NOT NULL DEFAULT '{}'::text[]
                                  CHECK (array_length(redirect_uris, 1) IS NULL
                                         OR array_length(redirect_uris, 1) BETWEEN 1 AND 20),

  -- The set of scopes this client is allowed to request. The authorize
  -- endpoint intersects the incoming scope parameter with this array
  -- and rejects any scope not on this list. See oauth_scope_service.ts
  -- for the canonical scope map.
  allowed_scopes      text[]      NOT NULL DEFAULT '{}'::text[],

  is_confidential     boolean     NOT NULL DEFAULT false,

  -- First-party clients (maintained by the Context Store team) get a
  -- slightly different consent UX: a "Trusted" badge and no "unknown
  -- developer" warning. Third-party registrations default to false.
  is_first_party      boolean     NOT NULL DEFAULT false,

  status              text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'suspended', 'deleted')),

  -- auth.users.id of the human who registered this client. Nullable
  -- because first-party seeded clients don't have a human creator.
  created_by          uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_clients_status_idx ON public.oauth_clients (status);

CREATE TRIGGER oauth_clients_set_updated_at
  BEFORE UPDATE ON public.oauth_clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can SELECT an active client (so the consent
-- screen can render its name / logo). Secrets never leave the service
-- layer — we only expose `client_id`, `name`, `description`, etc. via
-- service-layer getters that omit `client_secret_hash`.
CREATE POLICY oauth_clients_authenticated_select
  ON public.oauth_clients
  FOR SELECT
  TO authenticated
  USING (status = 'active');

-- Only first-party provisioning writes clients in V1. A user-facing
-- developer portal for self-service registration is a separate
-- surface; until that ships, INSERT/UPDATE/DELETE go through the
-- service-role admin client.

-- ---------------------------------------------------------------------------
-- 2. oauth_authorization_codes
--
--   Single-use codes minted at the end of the authorize flow and
--   redeemed at the token endpoint. Short TTL (default 10 minutes).
--   PKCE code_challenge is captured here and verified at exchange.
-- ---------------------------------------------------------------------------

CREATE TABLE public.oauth_authorization_codes (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SHA-256 hash of the code. The raw code is only ever in the
  -- redirect URL back to the client and never persisted.
  code_hash               text        NOT NULL UNIQUE,

  client_id               text        NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
  user_id                 uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Workspace the user chose to authorize the connector for. Bound
  -- here so the code cannot be swapped to a different workspace at
  -- exchange time.
  workspace_id            uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  redirect_uri            text        NOT NULL,
  scope                   text        NOT NULL,

  -- PKCE fields. code_challenge_method is always 'S256' for OAuth 2.1
  -- conformance; 'plain' is explicitly not accepted.
  code_challenge          text        NOT NULL,
  code_challenge_method   text        NOT NULL DEFAULT 'S256'
                                      CHECK (code_challenge_method = 'S256'),

  expires_at              timestamptz NOT NULL,
  used_at                 timestamptz,

  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_authorization_codes_expires_at_idx
  ON public.oauth_authorization_codes (expires_at)
  WHERE used_at IS NULL;

-- Only the service-role (token endpoint) reads or writes these. No
-- authenticated-user RLS needed because the code is consumed on the
-- server side.
ALTER TABLE public.oauth_authorization_codes ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. oauth_access_tokens
--
--   Opaque 32-byte bearer tokens presented by connectors to /api/mcp
--   and the canonical API. Stored as prefix + SHA-256 hash for
--   constant-time verification. Short TTL (default 1 hour); connectors
--   refresh via refresh_tokens.
-- ---------------------------------------------------------------------------

CREATE TABLE public.oauth_access_tokens (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- First 8 hex characters of the raw token. Indexed for fast lookup.
  token_prefix        text        NOT NULL,

  -- SHA-256 hex of the full raw token.
  token_hash          text        NOT NULL UNIQUE,

  client_id           text        NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id        uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- Space-separated scope string granted to this token. Never broader
  -- than the parent consent's scopes.
  scope               text        NOT NULL,

  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  last_used_at        timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_access_tokens_prefix_idx ON public.oauth_access_tokens (token_prefix);
CREATE INDEX oauth_access_tokens_user_client_idx
  ON public.oauth_access_tokens (user_id, client_id);
CREATE INDEX oauth_access_tokens_expires_at_idx
  ON public.oauth_access_tokens (expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.oauth_access_tokens ENABLE ROW LEVEL SECURITY;

-- Users can SELECT their own tokens (so the Connected Apps UI can list
-- active sessions). UPDATE is limited to revocation; DELETE not
-- exposed — expired tokens age out naturally.
CREATE POLICY oauth_access_tokens_user_select
  ON public.oauth_access_tokens
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY oauth_access_tokens_user_revoke
  ON public.oauth_access_tokens
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. oauth_refresh_tokens
--
--   Refresh tokens rotate on every use. The chain is threaded via
--   `replaced_by_token_id`; any reuse of a revoked token nukes the
--   whole chain (defense against token theft per RFC 6749 §10.4).
-- ---------------------------------------------------------------------------

CREATE TABLE public.oauth_refresh_tokens (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  token_prefix            text        NOT NULL,
  token_hash              text        NOT NULL UNIQUE,

  client_id               text        NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
  user_id                 uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id            uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  scope                   text        NOT NULL,

  -- The access_token this refresh token was issued alongside (at
  -- issuance time). When the refresh token is exchanged we issue a
  -- new access_token and a new refresh_token; the old ones are
  -- revoked.
  access_token_id         uuid        REFERENCES public.oauth_access_tokens(id) ON DELETE SET NULL,

  -- Chain link: the new refresh token that superseded this one, if
  -- any. Null means this is the current tip of the chain.
  replaced_by_token_id    uuid        REFERENCES public.oauth_refresh_tokens(id) ON DELETE SET NULL,

  -- Chain root: every refresh token from the same authorization grant
  -- shares one family_id. Revoking the family revokes every member in
  -- one UPDATE.
  family_id               uuid        NOT NULL,

  expires_at              timestamptz NOT NULL,
  revoked_at              timestamptz,
  used_at                 timestamptz,

  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_refresh_tokens_prefix_idx ON public.oauth_refresh_tokens (token_prefix);
CREATE INDEX oauth_refresh_tokens_family_idx ON public.oauth_refresh_tokens (family_id);
CREATE INDEX oauth_refresh_tokens_user_client_idx
  ON public.oauth_refresh_tokens (user_id, client_id);

ALTER TABLE public.oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY oauth_refresh_tokens_user_select
  ON public.oauth_refresh_tokens
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY oauth_refresh_tokens_user_revoke
  ON public.oauth_refresh_tokens
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. oauth_consents
--
--   Records the user's "Approve" decision for a (client, workspace)
--   pair, so subsequent authorize calls for the same scope set skip
--   the consent screen. Revoking a consent cascades to every live
--   token — the token service checks `consent_revoked_at` on lookup.
-- ---------------------------------------------------------------------------

CREATE TABLE public.oauth_consents (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id       text        NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  scopes          text[]      NOT NULL DEFAULT '{}'::text[],

  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,

  UNIQUE (user_id, client_id, workspace_id)
);

CREATE INDEX oauth_consents_user_idx ON public.oauth_consents (user_id);
CREATE INDEX oauth_consents_client_idx ON public.oauth_consents (client_id);

ALTER TABLE public.oauth_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY oauth_consents_user_select
  ON public.oauth_consents
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY oauth_consents_user_write
  ON public.oauth_consents
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. Seed a first-party MCP connector client
--
--   Registers a built-in client that any self-hosted deployment can
--   use to point a Claude Desktop / OpenAI-style connector at its own
--   /api/mcp endpoint without going through developer registration.
--   The client is PUBLIC (no secret), PKCE-only, first-party-badged.
--   Redirect URIs include the common loopback and CLI OOB values.
-- ---------------------------------------------------------------------------

INSERT INTO public.oauth_clients (
  client_id, client_secret_hash, name, description,
  redirect_uris, allowed_scopes,
  is_confidential, is_first_party, status
)
VALUES (
  'context-store-connector',
  NULL,
  'Context Store Connector',
  'Built-in connector for Claude Desktop / OpenAI apps / custom MCP clients. Uses PKCE.',
  ARRAY[
    'urn:ietf:wg:oauth:2.0:oob',
    'http://127.0.0.1/callback',
    'http://localhost/callback'
  ],
  ARRAY[
    'context:read',
    'context:search',
    'context:bundles',
    'context:propose',
    'context:generate'
  ],
  false, true, 'active'
)
ON CONFLICT (client_id) DO NOTHING;
