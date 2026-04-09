import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Admin Supabase client factory.
 *
 * Uses the SUPABASE_SERVICE_ROLE_KEY, which bypasses all Row Level Security
 * policies. This client MUST only be used in server-side code for operations
 * where a user session does not exist — specifically:
 *
 *   - Bearer token authentication in API route handlers (looking up connection
 *     tokens, resolving workspace ownership for the incoming request)
 *   - Admin-level operations that cannot go through the per-user cookie client
 *
 * Security contract:
 *   - NEVER import this in client components or browser code.
 *   - NEVER skip workspace_id / box_id ownership filters when querying data.
 *   - All application-level authorization must be enforced explicitly by the
 *     caller because RLS is not in effect.
 *
 * Call createAdminClient() per request — do not cache the instance across
 * requests (the service role key is static but the client is stateless).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — set it in .env.local");

  return createSupabaseClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
