-- =============================================================================
-- Context Store — MCP auth hardening
-- Migration: 20260413000006_mcp_auth_hardening.sql
--
-- Consolidates the MCP auth surface around the OAuth 2.1 server and
-- begins the deprecation of the legacy csk_v1_ connection-token flow.
--
-- Design notes:
--
-- * OAuth is the primary public MCP auth flow going forward. Legacy
--   connection tokens remain callable behind an explicit opt-in env
--   flag (CONTEXT_STORE_LEGACY_CSK_ENABLED) for first-party local
--   development only.
--
-- * Every column added here is nullable and non-breaking: existing
--   rows continue to resolve exactly as before. No data migration is
--   required.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. oauth_access_tokens / oauth_refresh_tokens — cross-link audit trail
--
--   Lets the resolver persist the audit event id that first observed a
--   given token. Useful for "first use" forensic trails and for
--   answering "when was this token first seen in the wild" without
--   joining against the full audit stream.
-- ---------------------------------------------------------------------------

ALTER TABLE public.oauth_access_tokens
  ADD COLUMN IF NOT EXISTS last_audit_event_id uuid;

ALTER TABLE public.oauth_refresh_tokens
  ADD COLUMN IF NOT EXISTS last_audit_event_id uuid;

-- ---------------------------------------------------------------------------
-- 2. oauth_clients.deprecated_at
--
--   Soft-deprecate an OAuth client without revoking tokens. The admin
--   UI surfaces the deprecation warning; tokens still resolve until
--   the client is set to status='suspended' or 'deleted'. This is the
--   standard "warn first, then cut over" shape.
-- ---------------------------------------------------------------------------

ALTER TABLE public.oauth_clients
  ADD COLUMN IF NOT EXISTS deprecated_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. connections.deprecated_at
--
--   Marks the legacy csk_v1_ connection family as deprecated. Tokens
--   tied to a deprecated connection still verify (callers must migrate
--   to OAuth at their own pace), but the admin UI surfaces a warning
--   banner and the auth adapter emits a "legacy_token_used" audit
--   event once per hour per token.
-- ---------------------------------------------------------------------------

ALTER TABLE public.connections
  ADD COLUMN IF NOT EXISTS deprecated_at timestamptz;

-- ---------------------------------------------------------------------------
-- 4. connection_tokens.last_warned_at
--
--   Rate-limit marker for the "deprecated token used" audit event.
--   The adapter writes at most one event per token per hour so an
--   agent that polls aggressively does not drown the audit stream.
-- ---------------------------------------------------------------------------

ALTER TABLE public.connection_tokens
  ADD COLUMN IF NOT EXISTS last_warned_at timestamptz;

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------

-- Helps the adapter look up tokens about to emit a deprecation warning.
CREATE INDEX IF NOT EXISTS connection_tokens_last_warned_at_idx
  ON public.connection_tokens (last_warned_at);

-- Helps admin queries "show me every deprecated connection in the
-- workspace".
CREATE INDEX IF NOT EXISTS connections_deprecated_at_idx
  ON public.connections (workspace_id, deprecated_at)
  WHERE deprecated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS oauth_clients_deprecated_at_idx
  ON public.oauth_clients (deprecated_at)
  WHERE deprecated_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Audit event helpers — no schema change needed; documented here
--    so the set is discoverable alongside the migration.
--
--    Event types that the MCP auth adapter emits (stored in
--    audit_events.event_type; audit_events.metadata is jsonb and
--    carries the full context):
--
--      oauth_client.registered        — new client created
--      oauth_client.updated           — client metadata patched
--      oauth_client.deprecated        — deprecated_at set
--      oauth_consent.granted          — user approved authorize
--      oauth_consent.revoked          — user revoked consent
--      oauth_token.issued             — token pair issued
--      oauth_token.revoked            — token explicitly revoked
--      mcp.legacy_token_used          — deprecated csk_v1_ token seen
--                                       (rate-limited, 1/hour/token)
-- ---------------------------------------------------------------------------
