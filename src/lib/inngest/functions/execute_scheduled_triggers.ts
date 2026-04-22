/**
 * Fire scheduled agent / workflow triggers.
 *
 * Runs every minute on Inngest's cron. For each enabled `schedule` trigger
 * we ask cron-parser for the most recent scheduled time (`.prev()`). If
 * that time falls within the last 60 seconds, the trigger is due.
 *
 * A trigger targets exactly one of:
 *   - agent_id set   → dispatch via `runAgentExecution`
 *   - workflow_id set → create a `workflow_runs` row + send `workflow.run`
 *
 * Idempotency:
 *   - The per-trigger `step.run` id is `trigger-{id}-bucket-{minute}`.
 *     Inngest memoizes by step id, so if this function retries inside
 *     the same minute bucket the work isn't dispatched twice.
 *   - The application-layer guard in `runAgentExecution` covers the
 *     remaining case where a long-running prior agent execution is still
 *     open. For workflow runs, each due tick creates a new workflow run
 *     row (same as a manual Run button press).
 */
import parser from "cron-parser";
import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeCron } from "@/lib/cron";
import { createWorkflowRun } from "@/server/repositories/workflow_run_repository";
import { runAgentExecution } from "./run_agent_execution";

// How far back we look for a matching cron tick. Set equal to the cron
// period (60s) so every minute fires at most once.
const DUE_WINDOW_MS = 60_000;

interface DueTrigger {
  id: string;
  agent_id: string | null;
  workflow_id: string | null;
  workspace_id: string;
}

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
        .select("id, cron_expression, agent_id, workflow_id, workspace_id")
        .eq("trigger_type", "schedule")
        .eq("is_enabled", true);
      if (error) throw error;
      return data ?? [];
    });

    const due: DueTrigger[] = [];
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
          due.push({
            id: t.id,
            agent_id: t.agent_id ?? null,
            workflow_id: t.workflow_id ?? null,
            workspace_id: t.workspace_id,
          });
        }
      } catch {
        // Already filtered by describeCron, but belt-and-braces — a
        // parser that rejects the expression is never "due".
      }
    }

    const results = await Promise.all(
      due.map((t) =>
        step.run(`trigger-${t.id}-bucket-${bucket}`, async () => {
          if (t.agent_id) {
            const agentResult = await runAgentExecution({
              triggerId: t.id,
              contextSuffix: `Scheduled run at ${new Date(nowMs).toISOString()}`,
            });
            return { kind: "agent" as const, triggerId: t.id, ...agentResult };
          }

          if (t.workflow_id) {
            // Workflow schedule — create a run row and dispatch.
            const input = { triggeredAt: new Date(nowMs).toISOString() };
            const run = await createWorkflowRun(admin, {
              workflow_id: t.workflow_id,
              workspace_id: t.workspace_id,
              user_id: null,
              input,
            });
            await inngest.send({
              name: "workflow.run",
              data: {
                workflowId: t.workflow_id,
                workspaceId: t.workspace_id,
                userId: null,
                input,
                runId: run.id,
              },
            });
            return { kind: "workflow" as const, triggerId: t.id, runId: run.id };
          }

          // Neither agent_id nor workflow_id — shouldn't happen due to the
          // DB CHECK constraint, but return a marker for visibility.
          return { kind: "noop" as const, triggerId: t.id };
        })
      )
    );

    return { checked: triggers.length, fired: due.length, results };
  }
);
