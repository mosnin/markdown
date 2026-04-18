-- Rate-limit bucket cleanup
--
-- The rate_limit_buckets table grows unbounded with ephemeral window buckets.
-- This migration adds a cleanup function that removes stale rows and runs it
-- once to clear any existing backlog.

CREATE OR REPLACE FUNCTION cleanup_stale_rate_limit_buckets(older_than_hours integer DEFAULT 24)
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM rate_limit_buckets WHERE window_start < now() - (older_than_hours || ' hours')::interval;
$$;

-- Run cleanup once to clear existing stale rows
SELECT cleanup_stale_rate_limit_buckets(24);
