/**
 * Execute a manual trigger invocation.
 *
 * Fired by the "Run now" server action in the agent triggers UI. This is
 * the simplest of the three Inngest functions — a single-shot wrapper
 * around `runAgentExecution` with a synthetic context line noting which
 * user clicked the button.
 */
import { inngest } from "@/lib/inngest/client";
import { runAgentExecution } from "./run_agent_execution";

export const executeManualTrigger = inngest.createFunction(
  {
    id: "execute-manual-trigger",
    name: "Execute manual agent trigger",
    retries: 3,
  },
  { event: "agent_trigger.manual" },
  async ({ event, step }) => {
    return await step.run("run-agent", () =>
      runAgentExecution({
        triggerId: event.data.triggerId,
        contextSuffix: `Manually invoked by user ${event.data.userId}`,
      })
    );
  }
);
