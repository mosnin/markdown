/**
 * Next.js instrumentation hook.
 * Runs once at server startup before any request is handled.
 *
 * Used to fail fast when required environment variables are missing.
 * This prevents obscure runtime errors deep inside service functions
 * (e.g. createAdminClient() throwing mid-request).
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateServerEnv } = await import("@/lib/env");
    validateServerEnv();
  }
}
