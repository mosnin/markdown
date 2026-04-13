import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Branch pending-operations service.
 *
 * The three shapes of branch-aware structural change:
 *
 *   1. CREATE on branch — covered by `branch_id` columns on files,
 *      notes, folders, boxes, object_links. See
 *      `docs/branch_local_structural_creation_v1.md`.
 *
 *   2. CONTENT EDIT on branch — covered by `branch_heads` +
 *      version tables. See `docs/branch_aware_writes_v1.md`.
 *
 *   3. STRUCTURAL INTENT against a main row (trash / archive /
 *      unarchive / move / detach) — covered here. Records an intent
 *      row in `branch_pending_ops`; reads overlay the intent (e.g.
 *      hide trashed rows), promote applies the op to the canonical
 *      row, discard drops the intent and leaves main untouched.
 *
 * Callers that want to write a pending op go through
 * `recordPendingOp`. Callers that want to know "is this main row
 * hidden by my active branch" go through `isHiddenByBranch`. The
 * promoter walks `listPendingOps` and `applyPendingOp`.
 *
 * The applier is intentionally split per op_type for auditability —
 * one function per op keeps the branching logic obvious and makes
 * change_set recording trivial at the call site.
 */

export type PendingOpType = "trash" | "archive" | "unarchive" | "move" | "detach";

export type PendingOpObjectType =
  | "note"
  | "file"
  | "folder"
  | "skill"
  | "agent"
  | "object_link"
  | "box_object_attachment"
  | "note_link";

export interface PendingOp {
  id: string;
  branch_id: string;
  op_type: PendingOpType;
  object_type: PendingOpObjectType;
  object_id: string;
  payload: Record<string, unknown>;
  actor_id: string | null;
  created_at: string;
  applied_at: string | null;
}

// ─── Record / list / drop ────────────────────────────────────────────────────

export interface RecordPendingOpInput {
  branchId: string;
  actorId: string;
  opType: PendingOpType;
  objectType: PendingOpObjectType;
  objectId: string;
  payload?: Record<string, unknown>;
}

/**
 * Upsert a pending op. The UNIQUE constraint on
 * (branch_id, op_type, object_type, object_id) means a second call
 * with the same target and op type is idempotent; a DIFFERENT
 * op_type against the same target adds a new row.
 *
 * Callers that want a "swap" semantic (e.g. the user archived then
 * unarchived on the same branch) should delete the old op before
 * recording the new one — see `dropPendingOps`.
 */
export async function recordPendingOp(
  supabase: SupabaseClient,
  input: RecordPendingOpInput
): Promise<PendingOp> {
  const { data, error } = await supabase
    .from("branch_pending_ops")
    .upsert(
      {
        branch_id: input.branchId,
        op_type: input.opType,
        object_type: input.objectType,
        object_id: input.objectId,
        payload: input.payload ?? {},
        actor_id: input.actorId,
      },
      { onConflict: "branch_id,op_type,object_type,object_id" }
    )
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to record pending op");
  return data as PendingOp;
}

export async function listPendingOps(
  supabase: SupabaseClient,
  branchId: string
): Promise<PendingOp[]> {
  const { data } = await supabase
    .from("branch_pending_ops")
    .select("*")
    .eq("branch_id", branchId)
    .is("applied_at", null)
    .order("created_at", { ascending: true });
  return (data ?? []) as PendingOp[];
}

/**
 * Drop pending ops for a target. Used when the user changes their
 * mind on a branch ("unarchive this, actually" → drop the archive
 * op rather than stack one on top). Optionally scopes by op_type
 * when only a specific op should be reversed.
 */
export async function dropPendingOps(
  supabase: SupabaseClient,
  input: {
    branchId: string;
    objectType: PendingOpObjectType;
    objectId: string;
    opType?: PendingOpType;
  }
): Promise<void> {
  let q = supabase
    .from("branch_pending_ops")
    .delete()
    .eq("branch_id", input.branchId)
    .eq("object_type", input.objectType)
    .eq("object_id", input.objectId);
  if (input.opType) q = q.eq("op_type", input.opType);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

/**
 * Hard-delete every pending op for a branch. Called by the discard
 * path — branch intents never took effect, there's no history to
 * preserve.
 */
export async function dropAllPendingOpsForBranch(
  supabase: SupabaseClient,
  branchId: string
): Promise<void> {
  await supabase.from("branch_pending_ops").delete().eq("branch_id", branchId);
}

// ─── Read-side predicate ─────────────────────────────────────────────────────

/**
 * Return the set of `(object_type, object_id)` pairs on this branch
 * that are hidden from active reads — i.e., have a pending `trash`
 * op. Archive leaves the row visible but status-flagged; trash
 * hides. Move and detach don't hide the source row.
 *
 * The caller typically loads this once per page render and passes
 * the hidden set to every list call that needs filtering.
 */
export async function getHiddenByPendingOps(
  supabase: SupabaseClient,
  branchId: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from("branch_pending_ops")
    .select("object_type, object_id")
    .eq("branch_id", branchId)
    .eq("op_type", "trash")
    .is("applied_at", null);
  const out = new Set<string>();
  for (const r of data ?? []) {
    out.add(`${r.object_type}:${r.object_id}`);
  }
  return out;
}

// ─── Applier (used by promoteBranch) ─────────────────────────────────────────

/**
 * Apply a single pending op to main. Returns a summary suitable for
 * inclusion in a change_set_item.
 *
 * Idempotent: applying a trash op to an already-trashed row is a
 * no-op (the status update matches what's already there), so
 * replaying doesn't break trust.
 */
export async function applyPendingOp(
  supabase: SupabaseClient,
  op: PendingOp
): Promise<{ ok: true; before: Record<string, unknown>; after: Record<string, unknown> }> {
  const tableMap: Record<PendingOpObjectType, string | null> = {
    note: "notes",
    file: "files",
    folder: "folders",
    skill: "skills",
    agent: "agents",
    object_link: "object_links",
    box_object_attachment: "box_object_attachments",
    note_link: "note_links",
  };
  const table = tableMap[op.object_type];
  if (!table) throw new Error(`Unsupported pending op target: ${op.object_type}`);

  switch (op.op_type) {
    case "trash":
    case "archive":
    case "unarchive": {
      // box_object_attachment rows are reference-only — they have no
      // lifecycle of their own (detach is the only meaningful op).
      // object_link rows are the same. Refuse the nonsensical combo
      // rather than silently corrupting state.
      if (
        op.object_type === "box_object_attachment" ||
        op.object_type === "object_link" ||
        op.object_type === "note_link"
      ) {
        throw new Error(
          `Unsupported pending op: cannot ${op.op_type} a ${op.object_type}; use detach instead.`
        );
      }
      const targetStatus =
        op.op_type === "trash" ? "trashed" :
        op.op_type === "archive" ? "archived" : "active";
      const { data: before } = await supabase
        .from(table)
        .select("id, status")
        .eq("id", op.object_id)
        .maybeSingle();
      await supabase
        .from(table)
        .update({ status: targetStatus })
        .eq("id", op.object_id);
      // Mark the op as applied so the pending-op indexes don't
      // surface it on subsequent reads. We intentionally keep the
      // row for audit rather than deleting.
      await supabase
        .from("branch_pending_ops")
        .update({ applied_at: new Date().toISOString() })
        .eq("id", op.id);
      return {
        ok: true,
        before: { status: before?.status ?? null },
        after: { status: targetStatus },
      };
    }
    case "move": {
      // payload carries { box_id?, folder_id?, sort_order?,
      // path_cache? } — only the fields the caller wants to change.
      const patch: Record<string, unknown> = {};
      for (const k of ["box_id", "folder_id", "sort_order", "path_cache"]) {
        if (op.payload[k] !== undefined) patch[k] = op.payload[k];
      }
      if (Object.keys(patch).length === 0) {
        await supabase
          .from("branch_pending_ops")
          .update({ applied_at: new Date().toISOString() })
          .eq("id", op.id);
        return { ok: true, before: {}, after: {} };
      }
      const { data: before } = await supabase
        .from(table)
        .select(Object.keys(patch).join(", "))
        .eq("id", op.object_id)
        .maybeSingle();
      await supabase
        .from(table)
        .update(patch)
        .eq("id", op.object_id);
      await supabase
        .from("branch_pending_ops")
        .update({ applied_at: new Date().toISOString() })
        .eq("id", op.id);
      return { ok: true, before: (before ?? {}) as Record<string, unknown>, after: patch };
    }
    case "detach": {
      // Applies to object_link and box_object_attachment — both are
      // pure reference rows; promoting the intent means deleting the
      // row from the canonical table (`object_links` or
      // `box_object_attachments`).
      await supabase.from(table).delete().eq("id", op.object_id);
      await supabase
        .from("branch_pending_ops")
        .update({ applied_at: new Date().toISOString() })
        .eq("id", op.id);
      return {
        ok: true,
        before: { existed: true },
        after: { deleted: true },
      };
    }
  }
}
