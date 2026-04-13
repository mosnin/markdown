import { type SupabaseClient } from "@supabase/supabase-js";
import {
  recordPendingOp,
  dropPendingOps,
  type PendingOpObjectType,
} from "./pending_op_service";

/**
 * Shared branch-aware lifecycle router for notes, files, skills, and
 * agents.
 *
 * Every lifecycle transition (archive / unarchive / trash /
 * restore_lifecycle) has the same shape: when the user is editing on
 * a draft branch we must NOT mutate the canonical main row. Instead
 * we record a `branch_pending_ops` intent; promote applies it, discard
 * drops it. This mirrors `runNoteLifecycle` in
 * `src/app/app/notes/[note_id]/actions.ts` but factored so the other
 * object types call the same code path.
 *
 * Swap semantics:
 *   - archive followed by unarchive on the same branch: the unarchive
 *     drops the archive op rather than stacking a second op. This is
 *     what the user expects — "I changed my mind, leave main alone".
 *   - trash followed by restore_lifecycle: same shape, drops the trash.
 *
 * The function never touches the target main row when `branchId` is
 * set. When `branchId` is null it returns `{ appliedToMain: true }`
 * and the caller runs the existing main-mutating lifecycle code.
 */
export type BranchLifecycleOp =
  | "archive"
  | "unarchive"
  | "trash"
  | "restore_lifecycle";

export interface RunLifecycleOnBranchInput {
  supabase: SupabaseClient;
  branchId: string | null | undefined;
  actorId: string;
  objectType: Extract<PendingOpObjectType, "note" | "file" | "skill" | "agent">;
  objectId: string;
  op: BranchLifecycleOp;
}

export interface RunLifecycleOnBranchResult {
  /** True when the caller should run its main-path lifecycle write
   *  (no branch active). False when the intent was recorded on the
   *  branch and main must be left alone. */
  appliedToMain: boolean;
}

export async function runLifecycleOnBranchOrMain(
  input: RunLifecycleOnBranchInput
): Promise<RunLifecycleOnBranchResult> {
  if (!input.branchId) return { appliedToMain: true };

  // Swap semantics: unarchive undoes a prior archive op, restore
  // undoes a prior trash op. Drop the opposite intent rather than
  // stacking a positive one — "do X then undo X" on a branch should
  // net to zero, leaving no pending op and therefore no change
  // displayed in the diff surface.
  if (input.op === "unarchive") {
    await dropPendingOps(input.supabase, {
      branchId: input.branchId,
      objectType: input.objectType,
      objectId: input.objectId,
      opType: "archive",
    });
  } else if (input.op === "restore_lifecycle") {
    await dropPendingOps(input.supabase, {
      branchId: input.branchId,
      objectType: input.objectType,
      objectId: input.objectId,
      opType: "trash",
    });
  }

  // Positive intents (archive/trash) are recorded as pending ops. A
  // pure restore/unarchive whose only effect was to cancel a prior
  // op has nothing left to record.
  const pendingOpType =
    input.op === "archive" ? ("archive" as const) :
    input.op === "trash" ? ("trash" as const) :
    input.op === "unarchive" ? ("unarchive" as const) :
    null;

  if (pendingOpType) {
    // For unarchive / trash after the opposite op was dropped we
    // don't need to *also* record the positive op — the drop already
    // produced the desired net state. But `archive` / `trash` on a
    // main row with no prior op MUST record an intent so the promote
    // applier can fire. We handle this with the simple rule: only
    // record the op if it's archive or trash, OR if unarchive was
    // called against an already-active main row and the user wants
    // to explicitly record "undo an archive that was never there"
    // (degenerate — drop above is idempotent).
    if (pendingOpType === "archive" || pendingOpType === "trash") {
      await recordPendingOp(input.supabase, {
        branchId: input.branchId,
        actorId: input.actorId,
        opType: pendingOpType,
        objectType: input.objectType,
        objectId: input.objectId,
        payload: {},
      });
    }
    // `unarchive` / `restore_lifecycle` never land a positive op —
    // they either cancelled a prior negative op (handled by the
    // dropPendingOps call above) or are a no-op on the branch when
    // main was already in the target state.
  }

  return { appliedToMain: false };
}
