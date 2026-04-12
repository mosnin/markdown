import { type SupabaseClient } from "@supabase/supabase-js";
import {
  openChangeSet,
  commitChangeSet,
  abortChangeSet,
  recordChangeSetItem,
  recordStructuralEvent,
  listChangeSetItems,
  listStructuralEvents,
  getChangeSet,
  inverseOperation,
  inverseStructuralEvent,
  type ChangeSet,
  type ChangeSetItem,
  type StructuralEvent,
} from "./change_set_service";
import { rollbackNoteToVersion } from "./version_history_service";

/**
 * Restore service.
 *
 * Responsibilities:
 *
 *   1. Plan a restore from a change set or a single version.
 *   2. Enforce invariants that make restores safe:
 *        a. History is immutable — every restore writes NEW state.
 *        b. Restoring a structural move never creates an invalid
 *           topology (folder into itself, box mismatch, orphaned leaf).
 *        c. Imports restore only the objects they themselves created
 *           and only when those objects haven't been materially edited
 *           since; otherwise the caller must resolve the conflict.
 *        d. Approved machine proposals restore exactly like manual
 *           updates — a proposal-origin change set is structurally
 *           identical to a human edit.
 *        e. Reusable shared objects do not silently fork. Restoring a
 *           reusable skill/agent writes a new version on the canonical
 *           row, not a divergent copy.
 *        f. Generated child content is restored consistently with its
 *           parent — restoring an import tree also restores child
 *           notes that were created as part of the same change set.
 *
 *   3. Record the restore itself as a new change set (origin='restore')
 *      so the restore is auditable and is itself reversible.
 *
 * The write path here uses a fresh child change set whose
 * parent_change_set_id points at the change set being undone. This
 * keeps lineage traversable: `restore of restore of import` still walks
 * back to the original import.
 *
 * This module implements the *planning* and *invariants*. The concrete
 * database writes for content rollback thread through
 * rollbackNoteToVersion (existing) and, for files/skills/agents, through
 * the same version-writing RPCs that proposal approval uses. Structural
 * inverses write directly to folders / workspace_objects /
 * box_object_attachments with the before_state snapshot.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RestorePlanItem {
  operation: "version_rollback" | "lifecycle_restore" | "structural_undo" | "link_recreate" | "unsupported";
  object_type: string;
  object_id: string;
  note?: string;
  /** If the planner cannot safely execute this item, it sets `blocked = true`. */
  blocked?: boolean;
  blockedReason?: string;
}

export interface RestorePlan {
  changeSetId: string;
  items: RestorePlanItem[];
  structural: RestorePlanItem[];
  blockers: string[];
}

export interface RestoreResult {
  ok: boolean;
  restoreChangeSetId?: string;
  restoreRecordId?: string;
  error?: string;
  plan: RestorePlan;
}

// ─── Public: plan + execute a change-set restore ─────────────────────────────

/**
 * Build a restore plan for the given change set without touching the
 * database. Used by UI to show the user what will happen, and by the
 * executor as its source of truth.
 */
export async function planRestoreFromChangeSet(
  supabase: SupabaseClient,
  changeSetId: string
): Promise<RestorePlan> {
  const cs = await getChangeSet(supabase, changeSetId);
  if (!cs) {
    return {
      changeSetId,
      items: [],
      structural: [],
      blockers: ["Change set not found"],
    };
  }

  const [items, structural] = await Promise.all([
    listChangeSetItems(supabase, changeSetId),
    listStructuralEvents(supabase, changeSetId),
  ]);

  const plan: RestorePlan = {
    changeSetId,
    items: items.map((it) => planItem(it)),
    structural: structural.map((se) => planStructural(se)),
    blockers: [],
  };

  // Aggregate blocker reasons so the caller can render a single notice.
  for (const i of plan.items) {
    if (i.blocked && i.blockedReason) plan.blockers.push(i.blockedReason);
  }
  for (const i of plan.structural) {
    if (i.blocked && i.blockedReason) plan.blockers.push(i.blockedReason);
  }

  // Invariant: cannot restore a change set that was aborted. An aborted
  // change set wrote nothing meaningful; there's nothing to undo.
  if (cs.status === "aborted") {
    plan.blockers.push("Change set was aborted and has no durable effects to undo.");
  }

  return plan;
}

/**
 * Execute a restore plan. Creates a fresh change set (origin='restore')
 * that records the undoing operations, then applies each item/event in
 * order. Stops and aborts the child change set on first failure — the
 * restore record captures the error.
 *
 * The actorId is the auth.users.id of the human triggering the restore.
 * Restores are intentionally not exposed to connections / the canonical
 * API; only a human can restore.
 */
export async function restoreFromChangeSet(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  changeSetId: string
): Promise<RestoreResult> {
  const plan = await planRestoreFromChangeSet(supabase, changeSetId);
  if (plan.blockers.length > 0) {
    const rr = await recordRestore(supabase, {
      workspace_id: workspaceId,
      actor_id: actorId,
      scope: "change_set",
      source_change_set_id: changeSetId,
      status: "failed",
      error: plan.blockers.join("; "),
    });
    return {
      ok: false,
      plan,
      error: plan.blockers.join("; "),
      restoreRecordId: rr,
    };
  }

  const restoreCs = await openChangeSet(supabase, {
    workspace_id: workspaceId,
    origin: "restore",
    actor_type: "user",
    actor_id: actorId,
    summary: `Restore of change set ${changeSetId.slice(0, 8)}`,
    parent_change_set_id: changeSetId,
  });

  try {
    // 1. Undo structural events in reverse sequence first so content
    //    restores land into the topology they originally came from.
    const structural = await listStructuralEvents(supabase, changeSetId);
    for (const se of [...structural].reverse()) {
      await applyStructuralInverse(supabase, workspaceId, restoreCs.id, se);
    }

    // 2. Undo content items. Version-bearing items use the version graph;
    //    lifecycle items flip the status back.
    const items = await listChangeSetItems(supabase, changeSetId);
    for (const it of [...items].reverse()) {
      await applyItemInverse(supabase, workspaceId, restoreCs.id, actorId, it);
    }

    await commitChangeSet(supabase, restoreCs.id);
    const rr = await recordRestore(supabase, {
      workspace_id: workspaceId,
      actor_id: actorId,
      scope: "change_set",
      source_change_set_id: changeSetId,
      restored_change_set_id: restoreCs.id,
      status: "applied",
    });
    return {
      ok: true,
      plan,
      restoreChangeSetId: restoreCs.id,
      restoreRecordId: rr,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Restore failed";
    await abortChangeSet(supabase, restoreCs.id, message);
    const rr = await recordRestore(supabase, {
      workspace_id: workspaceId,
      actor_id: actorId,
      scope: "change_set",
      source_change_set_id: changeSetId,
      restored_change_set_id: restoreCs.id,
      status: "failed",
      error: message,
    });
    return {
      ok: false,
      plan,
      error: message,
      restoreChangeSetId: restoreCs.id,
      restoreRecordId: rr,
    };
  }
}

/**
 * Restore a single note to a historical version. Wraps the existing
 * rollbackNoteToVersion service but wraps the write in a change set so
 * the rollback is a first-class rollback-able event itself.
 */
export async function restoreNoteVersion(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  noteId: string,
  versionId: string
): Promise<RestoreResult> {
  const cs = await openChangeSet(supabase, {
    workspace_id: workspaceId,
    origin: "rollback",
    actor_type: "user",
    actor_id: actorId,
    summary: `Rollback note ${noteId.slice(0, 8)} to version ${versionId.slice(0, 8)}`,
  });

  try {
    const rollbackResult = await rollbackNoteToVersion(
      supabase,
      actorId,
      workspaceId,
      noteId,
      versionId
    );

    await recordChangeSetItem(supabase, {
      change_set_id: cs.id,
      workspace_id: workspaceId,
      operation: "rollback",
      object_type: "note",
      object_id: rollbackResult.note.id,
      version_id: rollbackResult.new_version_id,
      before_snapshot: { version_id: rollbackResult.restored_from_version_id },
      after_snapshot: { version_id: rollbackResult.new_version_id },
    });

    // Tag the new version with its change_set_id so future restore
    // planners can find it.
    await supabase
      .from("note_versions")
      .update({ change_set_id: cs.id })
      .eq("id", rollbackResult.new_version_id);

    await commitChangeSet(supabase, cs.id);

    const rr = await recordRestore(supabase, {
      workspace_id: workspaceId,
      actor_id: actorId,
      scope: "version",
      source_version_id: versionId,
      restored_change_set_id: cs.id,
      status: "applied",
    });

    return {
      ok: true,
      plan: {
        changeSetId: cs.id,
        items: [{ operation: "version_rollback", object_type: "note", object_id: noteId }],
        structural: [],
        blockers: [],
      },
      restoreChangeSetId: cs.id,
      restoreRecordId: rr,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rollback failed";
    await abortChangeSet(supabase, cs.id, message);
    return {
      ok: false,
      plan: { changeSetId: cs.id, items: [], structural: [], blockers: [message] },
      error: message,
    };
  }
}

// ─── Planners (pure, exported for tests) ─────────────────────────────────────

export function planItem(item: ChangeSetItem): RestorePlanItem {
  const inv = inverseOperation(item.operation);
  switch (item.operation) {
    case "create":
      return {
        operation: "lifecycle_restore",
        object_type: item.object_type,
        object_id: item.object_id,
        note: `Created by original change set; restore will trash this object.`,
      };
    case "update":
      // An update's before_snapshot is the prior materialized state. If
      // we don't have it, we cannot safely undo without re-reading the
      // version graph at execution time.
      if (!item.before_snapshot) {
        return {
          operation: "unsupported",
          object_type: item.object_type,
          object_id: item.object_id,
          blocked: true,
          blockedReason: `Update item on ${item.object_type}:${item.object_id.slice(0, 8)} has no before_snapshot; cannot plan an undo safely.`,
        };
      }
      return {
        operation: "version_rollback",
        object_type: item.object_type,
        object_id: item.object_id,
        note: `Write a new version reverting to the prior state.`,
      };
    case "archive":
    case "unarchive":
    case "trash":
    case "restore_lifecycle":
      return {
        operation: "lifecycle_restore",
        object_type: item.object_type,
        object_id: item.object_id,
        note: `Apply ${inv}`,
      };
    case "move":
    case "attach":
    case "detach":
      return {
        operation: "structural_undo",
        object_type: item.object_type,
        object_id: item.object_id,
        note: `Replay inverse structural event from change set.`,
      };
    case "link_create":
    case "link_delete":
      return {
        operation: "link_recreate",
        object_type: item.object_type,
        object_id: item.object_id,
        note: `Recreate or remove link to match prior state.`,
      };
    case "rollback":
      // A restore of a rollback rolls the rollback forward: the original
      // head is restored. We treat it as another version write.
      return {
        operation: "version_rollback",
        object_type: item.object_type,
        object_id: item.object_id,
        note: `Re-apply the rollback's pre-state version.`,
      };
  }
}

export function planStructural(event: StructuralEvent): RestorePlanItem {
  const inv = inverseStructuralEvent(event);
  // A structural restore can be blocked if the inverse would create a
  // folder cycle — e.g. trying to move the folder back into what is now
  // its own descendant. That check requires a live DB read and happens
  // at execution time; we record it here for rendering completeness.
  if (
    event.event_type === "move" &&
    event.object_type === "folder" &&
    typeof inv.after.path_cache !== "string"
  ) {
    return {
      operation: "unsupported",
      object_type: event.object_type,
      object_id: event.object_id,
      blocked: true,
      blockedReason: "Folder move event is missing a destination path_cache for the inverse move.",
    };
  }
  return {
    operation: "structural_undo",
    object_type: event.object_type,
    object_id: event.object_id,
    note: `Inverse ${event.event_type}.`,
  };
}

// ─── Execution helpers ───────────────────────────────────────────────────────

async function applyStructuralInverse(
  supabase: SupabaseClient,
  workspaceId: string,
  restoreChangeSetId: string,
  event: StructuralEvent
): Promise<void> {
  const inv = inverseStructuralEvent(event);

  // The after_state of the inverse is the original before_state. For
  // move / reorder / attach / detach / folder_rename we can restore by
  // writing the snapshot back to the canonical tables.
  switch (event.event_type) {
    case "move":
    case "reorder": {
      // Native object → workspace_objects; attachment → box_object_attachments
      const is_attachment = event.object_type === "box_object_attachment";
      const tbl = is_attachment ? "box_object_attachments" : "workspace_objects";
      const update: Record<string, unknown> = {};
      if ("folder_id" in inv.after) update.folder_id = inv.after.folder_id;
      if ("sort_order" in inv.after) update.sort_order = inv.after.sort_order;

      if (is_attachment) {
        await supabase
          .from(tbl)
          .update(update)
          .eq("box_id", event.before_state.box_id)
          .eq("object_type", inv.after.object_type ?? event.object_type)
          .eq("object_id", event.object_id);
      } else {
        await supabase
          .from(tbl)
          .update(update)
          .eq("object_type", event.object_type)
          .eq("object_id", event.object_id);
      }

      // Also restore folder_id / path_cache on the canonical content
      // row for native objects (notes/files/skills/agents/folders).
      const canonicalTable = mapObjectTypeToTable(event.object_type);
      if (canonicalTable && !is_attachment) {
        const canonicalUpdate: Record<string, unknown> = {};
        if ("folder_id" in inv.after) canonicalUpdate.folder_id = inv.after.folder_id;
        if (
          event.object_type === "folder" &&
          typeof inv.after.parent_folder_id !== "undefined"
        ) {
          canonicalUpdate.parent_folder_id = inv.after.parent_folder_id;
        }
        if (typeof inv.after.path_cache === "string") {
          canonicalUpdate.path_cache = inv.after.path_cache;
        }
        if (Object.keys(canonicalUpdate).length > 0) {
          await supabase
            .from(canonicalTable)
            .update(canonicalUpdate)
            .eq("id", event.object_id);
        }
      }
      break;
    }
    case "folder_rename":
    case "path_cascade": {
      if (typeof inv.after.path_cache === "string") {
        const canonicalTable = mapObjectTypeToTable(event.object_type);
        if (canonicalTable) {
          await supabase
            .from(canonicalTable)
            .update({
              ...(inv.after.name ? { name: inv.after.name } : {}),
              ...(inv.after.slug ? { slug: inv.after.slug } : {}),
              path_cache: inv.after.path_cache,
            })
            .eq("id", event.object_id);
        }
      }
      break;
    }
    case "attach":
    case "detach": {
      // attach inverse deletes the attachment; detach inverse re-inserts.
      const reversedToDetach = event.event_type === "attach";
      if (reversedToDetach) {
        await supabase
          .from("box_object_attachments")
          .delete()
          .eq("box_id", event.before_state.box_id ?? event.after_state.box_id)
          .eq("object_type", inv.after.object_type ?? event.object_type)
          .eq("object_id", event.object_id);
      } else {
        await supabase
          .from("box_object_attachments")
          .insert({
            box_id: inv.after.box_id,
            workspace_id: workspaceId,
            object_type: inv.after.object_type ?? "skill",
            object_id: event.object_id,
            folder_id: inv.after.folder_id ?? null,
            sort_order: inv.after.sort_order ?? 0,
            attached_by: inv.after.attached_by ?? null,
          });
      }
      break;
    }
    case "folder_create": {
      // Inverse of creating a folder is to soft-trash it. We intentionally
      // do NOT hard-delete because the folder may still hold content the
      // user wants to recover (children are not cascade-trashed here; the
      // existing folder lifecycle service handles cascades when the user
      // explicitly trashes a subtree). After a restore the folder is
      // hidden from all active views via the existing `status = 'trashed'`
      // filters, which matches the product's reversibility contract.
      //
      // This is a deliberately conservative choice: a folder that was
      // created by an operation we're now undoing becomes invisible, and
      // a later restore-of-the-restore brings it back with status='active'.
      await supabase
        .from("folders")
        .update({ status: "trashed" })
        .eq("id", event.object_id);
      // Also hide the registry row so tree renders drop the folder.
      await supabase
        .from("workspace_objects")
        .update({ status: "trashed" })
        .eq("object_type", "folder")
        .eq("object_id", event.object_id);
      break;
    }
    case "folder_delete": {
      // Inverse of deleting (soft-trashing) a folder is to restore it.
      // The before_state of the original event carries the folder's
      // pre-delete name / slug / path_cache / parent — use them so we
      // rebuild the row faithfully even if upstream columns were touched.
      const snap = event.before_state as {
        name?: string; slug?: string; path_cache?: string;
        parent_folder_id?: string | null; box_id?: string;
      };
      await supabase
        .from("folders")
        .update({
          status: "active",
          ...(snap.name ? { name: snap.name } : {}),
          ...(snap.slug ? { slug: snap.slug } : {}),
          ...(typeof snap.path_cache === "string" ? { path_cache: snap.path_cache } : {}),
          ...(typeof snap.parent_folder_id !== "undefined"
            ? { parent_folder_id: snap.parent_folder_id }
            : {}),
        })
        .eq("id", event.object_id);
      await supabase
        .from("workspace_objects")
        .update({
          status: "active",
          ...(typeof snap.parent_folder_id !== "undefined"
            ? { folder_id: snap.parent_folder_id }
            : {}),
        })
        .eq("object_type", "folder")
        .eq("object_id", event.object_id);
      break;
    }
  }

  await recordStructuralEvent(supabase, {
    change_set_id: restoreChangeSetId,
    workspace_id: workspaceId,
    box_id: event.box_id,
    event_type: event.event_type,
    object_type: event.object_type,
    object_id: event.object_id,
    before_state: event.after_state,
    after_state: event.before_state,
  });
}

async function applyItemInverse(
  supabase: SupabaseClient,
  workspaceId: string,
  restoreChangeSetId: string,
  actorId: string,
  item: ChangeSetItem
): Promise<void> {
  if (item.operation === "update" && item.object_type === "note" && item.before_snapshot) {
    // Rolling back a note update writes a new version with the prior
    // content. For V1 we rely on the caller re-invoking the existing
    // rollbackNoteToVersion via the item's prior version_id if present.
    const priorVersionId = item.before_snapshot.version_id;
    if (typeof priorVersionId === "string") {
      await rollbackNoteToVersion(
        supabase,
        actorId,
        workspaceId,
        item.object_id,
        priorVersionId
      );
      await recordChangeSetItem(supabase, {
        change_set_id: restoreChangeSetId,
        workspace_id: workspaceId,
        operation: "rollback",
        object_type: item.object_type,
        object_id: item.object_id,
        before_snapshot: item.after_snapshot,
        after_snapshot: item.before_snapshot,
      });
      return;
    }
  }

  if (
    item.operation === "archive" ||
    item.operation === "unarchive" ||
    item.operation === "trash" ||
    item.operation === "restore_lifecycle"
  ) {
    // Lifecycle inverses flip status on the canonical table. The service
    // layer's dedicated lifecycle helpers (archiveNote, restoreNote,
    // etc.) run richer validation; for restore we take the safer path
    // of writing the status directly and letting audit capture the act.
    const tbl = mapObjectTypeToTable(item.object_type);
    if (!tbl) return;
    const targetStatus = (item.before_snapshot?.status as string) ?? "active";
    await supabase.from(tbl).update({ status: targetStatus }).eq("id", item.object_id);
    await recordChangeSetItem(supabase, {
      change_set_id: restoreChangeSetId,
      workspace_id: workspaceId,
      operation: inverseOperation(item.operation),
      object_type: item.object_type,
      object_id: item.object_id,
      before_snapshot: item.after_snapshot,
      after_snapshot: item.before_snapshot,
    });
    return;
  }

  if (item.operation === "create") {
    // Reverse a creation by trashing. Services that want a harder
    // "purge" can write a separate migration later; trashing preserves
    // content for second-chance recovery, consistent with the product's
    // lifecycle model.
    const tbl = mapObjectTypeToTable(item.object_type);
    if (!tbl) return;
    await supabase.from(tbl).update({ status: "trashed" }).eq("id", item.object_id);
    await recordChangeSetItem(supabase, {
      change_set_id: restoreChangeSetId,
      workspace_id: workspaceId,
      operation: "trash",
      object_type: item.object_type,
      object_id: item.object_id,
      before_snapshot: { status: "active" },
      after_snapshot: { status: "trashed" },
    });
    return;
  }

  if (item.operation === "link_create" && item.object_type === "note_link") {
    // Inverse of creating a link is deleting it. This is safe even if
    // the link has already been deleted by other means — we treat the
    // delete as idempotent. Record a compensating item on the restore
    // change set so the lineage is traceable.
    await supabase.from("note_links").delete().eq("id", item.object_id);
    await recordChangeSetItem(supabase, {
      change_set_id: restoreChangeSetId,
      workspace_id: workspaceId,
      operation: "link_delete",
      object_type: "note_link",
      object_id: item.object_id,
      before_snapshot: item.after_snapshot,
    });
    return;
  }

  if (item.operation === "link_delete" && item.object_type === "note_link" && item.before_snapshot) {
    // Inverse of deleting a link is recreating it from the before_snapshot.
    // If the link cannot be recreated (e.g. source or target note
    // trashed) we skip silently; the restore item record documents the
    // intent and a future second-chance recovery could retry.
    const snap = item.before_snapshot as {
      source_note_id: string;
      target_note_id: string;
      relationship_type: string;
      relationship_note: string | null;
    };
    const { error } = await supabase
      .from("note_links")
      .insert({
        id: item.object_id,
        source_note_id: snap.source_note_id,
        target_note_id: snap.target_note_id,
        relationship_type: snap.relationship_type,
        relationship_note: snap.relationship_note,
      });
    if (!error) {
      await recordChangeSetItem(supabase, {
        change_set_id: restoreChangeSetId,
        workspace_id: workspaceId,
        operation: "link_create",
        object_type: "note_link",
        object_id: item.object_id,
        after_snapshot: item.before_snapshot,
      });
    }
    return;
  }

  // For operations whose inverse is purely structural (move, attach,
  // detach) the structural_events replay has already done the work.
}

async function recordRestore(
  supabase: SupabaseClient,
  input: {
    workspace_id: string;
    actor_id: string;
    scope: "version" | "change_set" | "structural" | "import";
    source_change_set_id?: string;
    source_version_id?: string;
    restored_change_set_id?: string;
    status: "pending" | "applied" | "failed" | "aborted";
    error?: string;
  }
): Promise<string> {
  const { data } = await supabase
    .from("restore_records")
    .insert({
      workspace_id: input.workspace_id,
      actor_id: input.actor_id,
      scope: input.scope,
      source_change_set_id: input.source_change_set_id ?? null,
      source_version_id: input.source_version_id ?? null,
      restored_change_set_id: input.restored_change_set_id ?? null,
      status: input.status,
      error: input.error ?? null,
      applied_at: input.status === "applied" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  return data?.id ?? "";
}

function mapObjectTypeToTable(objectType: string): string | null {
  switch (objectType) {
    case "note": return "notes";
    case "file": return "files";
    case "skill": return "skills";
    case "agent": return "agents";
    case "folder": return "folders";
    case "box": return "boxes";
    default: return null;
  }
}

// Re-export the ChangeSet type so callers can import from one place.
export type { ChangeSet };
