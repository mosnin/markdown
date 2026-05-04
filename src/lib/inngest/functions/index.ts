/**
 * Barrel export for Inngest functions.
 *
 * The route handler at `src/app/api/inngest/route.ts` lazy-imports this
 * module and reads `allFunctions` to register with the `serve` helper.
 * Every new Inngest function MUST be added to the array below or it
 * won't be callable.
 */
import { executeManualTrigger } from "./execute_manual_trigger";
import { executeNoteTrigger } from "./execute_note_trigger";
import { executeScheduledTriggers } from "./execute_scheduled_triggers";
import { clearStuckTriggerRuns } from "./clear_stuck_trigger_runs";
import { executeWorkflow } from "./execute_workflow";
import { checkPerfAlertsFunction } from "./check_perf_alerts";

export const allFunctions = [
  executeManualTrigger,
  executeNoteTrigger,
  executeScheduledTriggers,
  clearStuckTriggerRuns,
  executeWorkflow,
  checkPerfAlertsFunction,
];

export {
  executeManualTrigger,
  executeNoteTrigger,
  executeScheduledTriggers,
  clearStuckTriggerRuns,
  executeWorkflow,
  checkPerfAlertsFunction,
};
export { runAgentExecution } from "./run_agent_execution";
