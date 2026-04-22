/**
 * Fire scheduled agent triggers.
 *
 * Runs every minute on Inngest's cron. For each enabled `schedule` trigger
 * we ask cron-parser for the most recent scheduled time (`.prev()`). If
 * that time falls within the last 60 seconds, the trigger is due.
 *
 * Idempotency:
 *   - The per-trigger `step.run` id is `trigger-{id}-bucket-{minute}`.
 *     Inngest memoizes by step id, so if this function retries inside
 *     the same minute bucket the agent won't be dispatched twice.
 *   - The application-layer guard in `runAgentExecution` covers the
 *     remaining case where a long-running prior execution is still open.
 */
import parser from "cron-parser";
import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeCron } from "@/lib/cron";
import { runAgentExecution } from "./run_agent_execution";

// How far back we look for a matching cron tick. Set equal to the cron
// period (60s) so every minute fires at most once.
const DUE_WINDOW_MS = 60_000;

export const executeScheduledTriggers = inngest.createFunction(
  {
    id: "execute-scheduled-triggers",
    name: "Fire scheduled agent triggers",
  },
  { cron: "* * * * *" },
  async ({ step }) => {
    const admin = createAdminClient();
    const nowMs = Date.now();
    const bucket = Math.floor(nowMs / 60_000).toString();

    const triggers = await step.run("load-schedule-triggers", async () => {
      const { data, error } = await admin
        .from("agent_triggers")
        .select("id, cron_expression")
        .eq("trigger_type", "schedule")
        .eq("is_enabled", true);
      if (error) throw error;
      return data ?? [];
    });

    const due: Array<{ id: string }> = [];
    const windowStart = nowMs - DUE_WINDOW_MS;

    for (const t of triggers) {
      if (!t.cron_expression) continue;
      // Guard against obviously malformed expressions before we hand
      // off to cron-parser — describeCron returns ok:false for bad input.
      const v = describeCron(t.cron_expression);
      if (!v.ok) continue;

      try {
        // cron-parser's `.prev()` gives the most recent scheduled time
        // strictly in the past relative to currentDate. If that time is
        // within our 60s window, the tick is "now" for our purposes.
        const prevMs = parser
          .parseExpression(t.cron_expression, {
            utc: true,
            currentDate: new Date(nowMs),
          })
          .prev()
          .getTime();
        if (prevMs >= windowStart && prevMs <= nowMs) {
          due.push({ id: t.id });
        }
      } catch {
        // Already filtered by describeCron, but belt-and-braces — a
        // parser that rejects the expression is never "due".
      }
    }

    const results = await Promise.all(
      due.map((t) =>
        step.run(`trigger-${t.id}-bucket-${bucket}`, () =>
          runAgentExecution({
            triggerId: t.id,
            contextSuffix: `Scheduled run at ${new Date(nowMs).toISOString()}`,
          })
        )
      )
    );

    return { checked: triggers.length, fired: due.length, results };
  }
);
