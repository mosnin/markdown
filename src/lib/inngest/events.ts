/**
 * Typed event registry for the Inngest client.
 *
 * Every event that any function anywhere in the app emits or subscribes
 * to MUST be declared here. The typed client (`inngest.send`) will refuse
 * to publish anything else at compile time.
 */


// ─── note lifecycle ─────────────────────────────────────────────────────
export interface NoteCreatedEvent {
  name: "note.created";
  data: {
    workspaceId: string;
    noteId: string;
    boxId: string;
    userId: string;
  };
}

export interface NoteUpdatedEvent {
  name: "note.updated";
  data: {
    workspaceId: string;
    noteId: string;
    boxId: string;
    userId: string;
    isFirstSave: boolean;
  };
}

// ─── trigger invocations ────────────────────────────────────────────────
export interface AgentTriggerManualEvent {
  name: "agent_trigger.manual";
  data: {
    triggerId: string;
    workspaceId: string;
    userId: string;
  };
}

export type AppEvents = {
  "note.created": NoteCreatedEvent;
  "note.updated": NoteUpdatedEvent;
  "agent_trigger.manual": AgentTriggerManualEvent;
};
