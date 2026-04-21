import * as Sentry from "@sentry/nextjs";
import { scrubEvent, scrubBreadcrumb } from "@/lib/sentry_redaction";

// Sentry server-side initialization.
// DSN is read from the NEXT_PUBLIC_SENTRY_DSN environment variable.
// If the variable is not set, Sentry is a no-op — the app runs without
// error reporting and never crashes due to a missing DSN.

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? "",

  // Performance tracing: sample 10% of transactions.
  tracesSampleRate: 0.1,

  // Only send events when a DSN is configured.
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // PII redaction: strip auth headers, tokens, emails, and sensitive
  // query params from events and breadcrumbs before sending.
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
  sendDefaultPii: false,
});
