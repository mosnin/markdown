/**
 * Structured server-side logger backed by pino.
 *
 * All log output is JSON-formatted so production log drains (Vercel, Datadog,
 * Axiom, etc.) can parse fields without regex.  In local dev, `pino-pretty`
 * renders human-readable lines.
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.error({ box_id, filename, reason: err.message }, "import_failed");
 *   logger.warn({ token_prefix }, "auth_token_expired");
 *   logger.info({ proposal_id, workspace_id }, "proposal_approved");
 *
 * The named export `log` preserves backward compatibility with the
 * pre-pino call-sites that use `log.info(event, ctx?)`.
 *
 * Rules:
 *   - NEVER log raw secrets, tokens, passwords, or service role keys.
 *   - NEVER log full connection tokens or Authorization header values.
 *   - Log token_prefix only (first 8 hex chars), never the hash.
 *   - Include request_id when available for correlation.
 */
import pino from "pino";

export const logger = pino({
  level:
    process.env.LOG_LEVEL ??
    (process.env.NODE_ENV === "production" ? "info" : "debug"),
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty" }
      : undefined,
  // Silence output during tests unless LOG_LEVEL is explicitly set.
  enabled: !(
    process.env.NODE_ENV === "test" && !process.env.LOG_LEVEL
  ),
});

// ── Backward-compatible `log` export ────────────────────────────────────────
//
// Existing call-sites use `log.info("event_name", { key: value })`.
// Pino's native API is `logger.info({ key: value }, "message")`.
// This thin adapter bridges the two so we don't need to rewrite every
// call-site in a single PR.

type LogContext = Record<string, unknown>;

export const log = {
  debug: (event: string, ctx?: LogContext) => logger.debug(ctx ?? {}, event),
  info: (event: string, ctx?: LogContext) => logger.info(ctx ?? {}, event),
  warn: (event: string, ctx?: LogContext) => logger.warn(ctx ?? {}, event),
  error: (event: string, ctx?: LogContext) => logger.error(ctx ?? {}, event),
};
