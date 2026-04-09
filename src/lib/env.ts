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
 * Optional (must be present in production):
 *   NEXT_PUBLIC_API_BASE_URL       — Used in connection UI to build example curl
 */

const REQUIRED_SERVER_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

export type RequiredEnvKey = (typeof REQUIRED_SERVER_ENV)[number];

/**
 * Validates that all required server environment variables are present.
 * Throws an Error listing every missing variable on failure.
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
