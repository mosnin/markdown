/**
 * Structured server-side logger.
 *
 * All log output is JSON-formatted so production log drains (Vercel, Datadog,
 * Axiom, etc.) can parse fields without regex.
 *
 * Usage:
 *   import { log } from "@/lib/logger";
 *   log.error("import_failed", { box_id, filename, reason: err.message });
 *   log.warn("auth_token_expired", { token_prefix });
 *   log.info("proposal_approved", { proposal_id, workspace_id });
 *
 * Rules:
 *   - NEVER log raw secrets, tokens, passwords, or service role keys.
 *   - NEVER log full connection tokens or Authorization header values.
 *   - Log token_prefix only (first 8 hex chars), never the hash.
 *   - Include request_id when available for correlation.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

function emit(level: LogLevel, event: string, ctx: LogContext = {}): void {
  // In production (or any non-test environment), write JSON to stdout/stderr.
  // Tests suppress output unless LOG_LEVEL=debug is set.
  if (process.env.NODE_ENV === "test" && process.env.LOG_LEVEL !== "debug") {
    return;
  }

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...ctx,
  };

  const line = JSON.stringify(entry);

  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const log = {
  debug: (event: string, ctx?: LogContext) => emit("debug", event, ctx),
  info: (event: string, ctx?: LogContext) => emit("info", event, ctx),
  warn: (event: string, ctx?: LogContext) => emit("warn", event, ctx),
  error: (event: string, ctx?: LogContext) => emit("error", event, ctx),
};
