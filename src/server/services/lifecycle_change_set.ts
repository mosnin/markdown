import { type SupabaseClient } from "@supabase/supabase-js";
import {
  openChangeSet,
  commitChangeSet,
  abortChangeSet,
  recordChangeSetItem,
  type ChangeSetItemOperation,
  type ChangeSetItemObjectType,
} from "./change_set_service";
import { logger } from "@/lib/logger";

/**
 * Helper that wraps a lifecycle transition in a change set so the
 * operation is grouped, attributable, and restorable.
 *
 * Callers pass:
 *   - the standard (supabase, workspaceId, userId) trio
 *   - the target object_type and object_id
 *   - a descriptive operation (archive / unarchive / trash /
 *     restore_lifecycle)
 *   - a `perform` callback that runs the actual state change and
 *     returns the POST-state value for the snapshot
 *   - the PRE-state value (usually `status`) so the restore planner
 *     can invert
 *
 * On success the change set is committed with a single item carrying
 * before_snapshot and after_snapshot. On throw the change set is
 * aborted and the original error is re-raised so the caller's own
 * error handling runs unchanged.
 *
 * The lifecycle service itself stays the trust boundary — it keeps
 * running its own validations (guide-note protection, subtree cascade
 * guards, etc.). This wrapper is strictly bookkeeping.
 */
export async function withLifecycleChangeSet<T>(
  supabase: SupabaseClient,
  args: {
    workspaceId: string;
    userId: string;
    objectType: ChangeSetItemObjectType;
    objectId: string;
    operation: Extract<
      ChangeSetItemOperation,
      "archive" | "unarchive" | "trash" | "restore_lifecycle"
    >;
    beforeStatus: string;
    afterStatus: string;
    summary: string;
    metadata?: Record<string, unknown>;
  },
  perform: () => Promise<T>
): Promise<T> {
  const cs = await openChangeSet(supabase, {
    workspace_id: args.workspaceId,
    origin: "lifecycle",
    actor_type: "user",
    actor_id: args.userId,
    summary: args.summary,
    metadata: {
      object_type: args.objectType,
      object_id: args.objectId,
      operation: args.operation,
      ...(args.metadata ?? {}),
    },
  });

  try {
    const result = await perform();
    await recordChangeSetItem(supabase, {
      change_set_id: cs.id,
      workspace_id: args.workspaceId,
      operation: args.operation,
      object_type: args.objectType,
      object_id: args.objectId,
      before_snapshot: { status: args.beforeStatus },
      after_snapshot: { status: args.afterStatus },
    });
    await commitChangeSet(supabase, cs.id);
    return result;
  } catch (err) {
    await abortChangeSet(
      supabase,
      cs.id,
      err instanceof Error ? err.message : "lifecycle failed"
    ).catch((abortErr) => { logger.error({ err: abortErr }, "abortChangeSet failed during lifecycle error handler"); });
    throw err;
  }
}

/** Map an archive-like op to the status it produces. */
export function lifecycleStatusFor(
  op: "archive" | "unarchive" | "trash" | "restore_lifecycle"
): string {
  switch (op) {
    case "archive":          return "archived";
    case "unarchive":        return "active";
    case "trash":            return "trashed";
    case "restore_lifecycle": return "active";
  }
}
