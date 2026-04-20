import type { OperatorRunStatus } from "@/server/services/workspace_operator_runs_service";

/**
 * UI-facing status bucket. The "running" bucket is a convenience group
 * that collapses executing / planning / awaiting_approval into a single
 * "in flight" filter. Callers pass one of these values; the action
 * expands "running" into the underlying status array.
 *
 * Lives in a separate module (not the "use server" file) because
 * Next.js only allows async exports from server-action files.
 */
export type OperatorRunStatusFilter =
  | "all"
  | "completed"
  | "failed"
  | "cancelled"
  | "running";

/**
 * Expand the UI-facing status bucket into the underlying service param.
 * Shared by the server action (runtime dispatch) and the page component
 * (initial render), so "Load more" and the first paint use the same
 * mapping.
 */
export function expandStatusFilter(
  bucket: OperatorRunStatusFilter | undefined
): OperatorRunStatus | OperatorRunStatus[] | undefined {
  if (!bucket || bucket === "all") return undefined;
  if (bucket === "running") {
    return ["executing", "planning", "awaiting_approval"];
  }
  return bucket;
}
