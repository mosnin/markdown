/**
 * Fan out `note.created` / `note.updated` events to all matching triggers.
 *
 * Matching rules:
 *   - workspace_id = event.data.workspaceId
 *   - trigger_type matches the event name
 *       ('note_created' for note.created, 'note_updated' for note.updated)
 *   - is_enabled = true
 *   - box_id IS NULL OR box_id = event.data.boxId
 *
 * Each matching trigger is executed in parallel via a dedicated
 * `step.run` call. Inngest memoizes step results per step id, so if this
 * function retries, triggers that already fired successfully won't fire
 * again.
 */
import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAgentExecution } from "./run_agent_execution";

export const executeNoteTrigger = inngest.createFunction(
  {
    id: "execute-note-trigger",
    name: "Fan out note events to matching triggers",
    retries: 3,
  },
  [{ event: "note.created" }, { event: "note.updated" }],
  async ({ event, step }) => {
    const admin = createAdminClient();

    const triggerType =
      event.name === "note.created" ? "note_created" : "note_updated";

    const matchingTriggers = await step.run(
      "find-matching-triggers",
      async () => {
        const { data, error } = await admin
          .from("agent_triggers")
          .select("id, box_id")
          .eq("workspace_id", event.data.workspaceId)
          .eq("trigger_type", triggerType)
          .eq("is_enabled", true);
        if (error) throw error;
        // Box filter: NULL box_id means "any box in the workspace".
        return (data ?? []).filter(
          (t) => !t.box_id || t.box_id === event.data.boxId
        );
      }
    );

    // Execute each match in parallel. Each trigger's execution is its
    // own Inngest step so retries are scoped per-trigger, not per-batch.
    const results = await Promise.all(
      matchingTriggers.map((t) =>
        step.run(`execute-${t.id}`, () =>
          runAgentExecution({
            triggerId: t.id,
            contextSuffix: `Triggered by ${event.name} on note ${event.data.noteId} in box ${event.data.boxId}`,
          })
        )
      )
    );

    return { triggersExecuted: results.length, results };
  }
);
