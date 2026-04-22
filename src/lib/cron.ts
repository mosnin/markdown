/**
 * Cron expression helpers.
 *
 * Thin wrapper over cronstrue (human-readable descriptions) and
 * cron-parser (next-run computation). Both libraries return errors via
 * throw; we catch and return a tagged result so callers don't need
 * try/catch sites everywhere.
 */
import cronstrue from "cronstrue";
import parser from "cron-parser";

export interface CronValid {
  ok: true;
  /** Human-readable, e.g. "At 09:00 on Monday" */
  description: string;
  /** ISO timestamps of the next 3 scheduled runs, UTC */
  nextRuns: string[];
}

export interface CronInvalid {
  ok: false;
  error: string;
}

export type CronValidation = CronValid | CronInvalid;

export function describeCron(expression: string): CronValidation {
  const trimmed = expression.trim();
  if (!trimmed) return { ok: false, error: "Cron expression required" };

  let description: string;
  try {
    description = cronstrue.toString(trimmed, { use24HourTimeFormat: true });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid cron" };
  }

  let nextRuns: string[];
  try {
    const iter = parser.parseExpression(trimmed, { utc: true });
    nextRuns = [iter.next().toISOString(), iter.next().toISOString(), iter.next().toISOString()];
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid cron" };
  }

  return { ok: true, description, nextRuns };
}

/** Short relative format — "in 3 hours", "in 2 days". */
export function formatRelativeFromNow(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return "overdue";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}
