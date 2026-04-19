/**
 * Server-side environment variable validation.
 *
 * Call `validateServerEnv()` at application startup to fail fast when required
 * environment variables are missing. This prevents obscure runtime errors deep
 * inside service functions.
 *
 * Required variables:
 *   NEXT_PUBLIC_SUPABASE_URL       — Supabase project URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY  — Public anon key (also used server-side)
 *   SUPABASE_SERVICE_ROLE_KEY      — Server-only service role key (bypasses RLS)
 *   NEXT_PUBLIC_APP_URL            — Application base URL for auth callbacks
 *
 * Recommended (warn when missing — should be set in production):
 *   NEXT_PUBLIC_SENTRY_DSN         — Sentry error tracking DSN
 *   WEBAUTHN_RP_ID                 — WebAuthn Relying Party ID (defaults to localhost)
 *   BRANCH_CLEANUP_CRON_TOKEN      — Shared secret for branch cleanup cron
 *   WORKSPACE_OPERATOR_URL         — Modal endpoint for the Workspace Operator agent
 *   WORKSPACE_OPERATOR_SHARED_SECRET — Shared secret for Poggle <-> Modal agent traffic
 *
 * Optional:
 *   NEXT_PUBLIC_API_BASE_URL       — Used in connection UI to build example curl
 *   NEXT_PUBLIC_DIFF_WORKER_URL    — Cloudflare diff worker URL
 *   NEXT_PUBLIC_BUNDLE_CACHE_URL   — Cloudflare bundle cache worker URL
 *   LOG_LEVEL                      — Application log level
 *   WORKSPACE_OPERATOR_ENABLED     — "true" to enable the Workspace Operator feature (default off)
 */

const REQUIRED_SERVER_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

/**
 * Variables that should be set in production but have safe defaults for
 * development. A warning is logged (not thrown) when these are missing.
 */
const RECOMMENDED_SERVER_ENV = [
  "NEXT_PUBLIC_SENTRY_DSN",
  "WEBAUTHN_RP_ID",
  "BRANCH_CLEANUP_CRON_TOKEN",
  "WORKSPACE_OPERATOR_URL",
  "WORKSPACE_OPERATOR_SHARED_SECRET",
] as const;

export type RequiredEnvKey = (typeof REQUIRED_SERVER_ENV)[number];

/**
 * Feature flag: is the Workspace Operator agent enabled?
 * Controlled by `WORKSPACE_OPERATOR_ENABLED=true` env var. Off by default so
 * prod deploys don't silently expose the feature before the Modal endpoint
 * and shared secret are configured. Also requires `WORKSPACE_OPERATOR_URL`
 * and `WORKSPACE_OPERATOR_SHARED_SECRET` to actually dispatch runs.
 */
export function isWorkspaceOperatorEnabled(): boolean {
  if (process.env.WORKSPACE_OPERATOR_ENABLED?.toLowerCase() !== "true") {
    return false;
  }
  return (
    !!process.env.WORKSPACE_OPERATOR_URL?.trim() &&
    !!process.env.WORKSPACE_OPERATOR_SHARED_SECRET?.trim()
  );
}

/**
 * Validates that all required server environment variables are present.
 * Throws an Error listing every missing variable on failure.
 * Logs warnings for recommended variables that are missing.
 *
 * Call this from instrumentation.ts (Next.js 15 startup hook) or at the top
 * of any server bootstrap path. It is safe to call multiple times.
 */
export function validateServerEnv(): void {
  const missing = REQUIRED_SERVER_ENV.filter(
    (key) => !process.env[key]?.trim()
  );

  if (missing.length > 0) {
    throw new Error(
      `[env] Missing required server environment variables:\n` +
        missing.map((k) => `  - ${k}`).join("\n") +
        `\n\nCopy .env.example to .env.local and fill in all required values.`
    );
  }

  // Warn about recommended variables that are missing in production
  if (process.env.NODE_ENV === "production") {
    const missingRecommended = RECOMMENDED_SERVER_ENV.filter(
      (key) => !process.env[key]?.trim()
    );
    if (missingRecommended.length > 0) {
      console.warn(
        `[env] Recommended environment variables not set (safe defaults used):\n` +
          missingRecommended.map((k) => `  - ${k}`).join("\n")
      );
    }
  }
}

/**
 * Type-safe environment variable accessor.
 * Returns the value or throws if missing (runtime guard for server code).
 */
export function requireEnv(key: RequiredEnvKey): string {
  const value = process.env[key];
  if (!value?.trim()) {
    throw new Error(`[env] Required environment variable ${key} is not set`);
  }
  return value;
}
