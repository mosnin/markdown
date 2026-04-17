/**
 * Next.js instrumentation hook.
 * Runs once at server startup before any request is handled.
 *
 * Responsibilities:
 *   1. Fail fast when required environment variables are missing.
 *   2. Initialise Sentry for the active runtime (Node.js or Edge).
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateServerEnv } = await import("@/lib/env");
    validateServerEnv();

    // Sentry server-side init — loaded dynamically so the config file
    // is only evaluated in the Node.js runtime.
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/**
 * Next.js onRequestError hook (Next.js 15+).
 * Automatically captures server-side request errors and sends them to Sentry.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const { captureRequestError } = await import("@sentry/nextjs");
  captureRequestError(error, request, context);
}
