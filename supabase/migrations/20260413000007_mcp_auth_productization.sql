-- =============================================================================
-- Context Store — MCP auth productization
-- Migration: 20260413000007_mcp_auth_productization.sql
--
-- Builds on 20260413000006_mcp_auth_hardening.sql.
--
-- 1. `rate_limit_buckets` — durable, cross-instance rate-limit state.
--    The in-process Map-based limiter in `src/lib/api/rate_limit.ts`
--    remains the right call for per-connection write bursts (it is
--    hot-pathed and locality-free). The *new* surfaces (dynamic client
--    registration, token endpoint, authorize, revoke) need counters
--    that survive across function instances and process restarts — a
--    malicious caller should not be able to escape the limit by
--    bouncing between regions.
--
-- 2. `oauth_clients.last_registration_ip` — captured so operators can
--    triage abusive dynamic registrations.
--
-- 3. `oauth_access_tokens.first_used_at` — the resolver populates this
--    the first time a token is successfully resolved. Powers the
--    "first seen" field in the Grants UI and helps distinguish
--    issued-but-never-used tokens from live ones.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. rate_limit_buckets
--
--   Fixed-window counter table. One row per (bucket_key, window_start).
--   `bucket_key` encodes the dimension:
--     "oauth_register:user:<uuid>"
--     "oauth_token:client:<client_id>"
--     "oauth_authorize:user:<uuid>"
--     "oauth_revoke:user:<uuid>"
--
--   The rate_limit_service does a bounded upsert:
--     INSERT ... ON CONFLICT DO UPDATE SET count = count + 1
--     WHERE count < limit
--   so the post-update row either reflects the new count or leaves the
--   over-limit count unchanged. Routes then compare `count` to `limit`
--   and decide whether to 429.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key    text        NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_key_window_idx
  ON public.rate_limit_buckets (bucket_key, window_start DESC);

-- Operators can run a periodic DELETE where window_start < now() - interval '1 day'.
-- Not adding a scheduled job here — deploy tooling decides cadence.

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- Service-role-only; no authenticated-user RLS needed. The service role
-- is the only actor that reads/writes this table.

-- ---------------------------------------------------------------------------
-- 2. oauth_clients.last_registration_ip
--
--   Populated by the dynamic registration endpoint. Helps tie an abusive
--   registration back to the source when combined with the rate-limit
--   trip audit event.
-- ---------------------------------------------------------------------------

ALTER TABLE public.oauth_clients
  ADD COLUMN IF NOT EXISTS last_registration_ip text;

-- ---------------------------------------------------------------------------
-- 3. oauth_access_tokens.first_used_at
--
--   One-shot column populated by `resolveAccessToken` the first time a
--   token actually authenticates a request. Distinguishes a token that
--   was minted but never presented from one that is in active use.
-- ---------------------------------------------------------------------------

ALTER TABLE public.oauth_access_tokens
  ADD COLUMN IF NOT EXISTS first_used_at timestamptz;

CREATE INDEX IF NOT EXISTS oauth_access_tokens_first_used_at_idx
  ON public.oauth_access_tokens (first_used_at)
  WHERE first_used_at IS NOT NULL;
