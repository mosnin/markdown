/**
 * Stuck-run cleanup function.
 *
 * Runs hourly. Any agent_trigger_run row stuck in `running` status for more
 * than 30 minutes indicates a Modal dispatch that timed out before the
 * terminal-status update was written. We mark those rows `failed` so the UI
 * never shows a perpetually-spinning badge and the application-level guard in
 * runAgentExecution doesn't block subsequent legitimate fires.
 *
 * The threshold is deliberately conservative (30m) to avoid interfering with
 * legitimately long-running Modal jobs.
 */
import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";

const STUCK_THRESHOLD_MINUTES = 30;

export const clearStuckTriggerRuns = inngest.createFunction(
  {
    id: "clear-stuck-trigger-runs",
    name: "Clear stuck agent trigger runs",
  },
  { cron: "0 * * * *" },
  async ({ step }) => {
    const admin = createAdminClient();

    const updated = await step.run("mark-stuck-runs-failed", async () => {
      const cutoff = new Date(
        Date.now() - STUCK_THRESHOLD_MINUTES * 60_000
      ).toISOString();

      const { data, error } = await admin
        .from("agent_trigger_runs")
        .update({
          status: "failed",
          error: `Marked failed by stuck-run cleanup: still running after ${STUCK_THRESHOLD_MINUTES} minutes`,
          completed_at: new Date().toISOString(),
        })
        .eq("status", "running")
        .lt("started_at", cutoff)
        .select("id");

      if (error) throw error;
      return (data ?? []).length;
    });

    return { markedFailed: updated };
  }
);
