/**
 * Onboarding milestone computation.
 *
 * Computes first-time user milestone state from workspace activity counts.
 * All data is derived from existing tables — no new schema required.
 */

export interface MilestoneStatus {
  id: string;
  label: string;
  done: boolean;
}

export function computeMilestones(data: {
  noteCount: number;
  boxCount: number;
  conversationCount: number;
  linkCount: number;
  bundleExportCount: number;
}): MilestoneStatus[] {
  return [
    {
      id: "first_note",
      label: "First note captured",
      done: data.noteCount > 0,
    },
    {
      id: "first_box",
      label: "First box created",
      done: data.boxCount > 0,
    },
    {
      id: "first_pog_conversation",
      label: "First Pog conversation",
      done: data.conversationCount > 0,
    },
    {
      id: "notes_connected",
      label: "Notes connected with a link",
      done: data.linkCount > 0,
    },
    {
      id: "bundle_exported",
      label: "Context bundle exported",
      done: data.bundleExportCount > 0,
    },
  ];
}
