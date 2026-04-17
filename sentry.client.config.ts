import * as Sentry from "@sentry/nextjs";

// Sentry client-side initialization.
// DSN is read from the NEXT_PUBLIC_SENTRY_DSN environment variable.
// If the variable is not set, Sentry is a no-op — no errors are
// reported and the app continues to work normally.

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? "",

  // Performance tracing: sample 10% of transactions.
  tracesSampleRate: 0.1,

  // Session Replay: disabled by default. Set to a positive value
  // (e.g. 0.1) in production to enable.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Only send events when a DSN is configured.
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});
