import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Draft branch foundation service.
 *
 * Context Store uses a Git-inspired trust model without being a
 * source-control product. Draft branches are named handles under which
 * working change sets can later be accumulated, compared to main, and
 * either promoted or discarded. Main is implicit — it is whatever the
 * canonical object.current_version_id points at for each content-bearing
 * object.
 *
 * V1 scope (this service):
 *
 *   - create / list / get / discard a draft branch
 *   - set / get a branch head for a (branch, object) pair
 *   - the persistence contract for branch promotion (the actual
 *     promotion flow wires into the restore-style machinery so every
 *     promotion is itself recorded as a change set)
 *
 * Out of scope for V1 (deliberate; noted in docs):
 *
 *   - writing to a branch head through the normal edit actions
 *   - branch-aware reads in the app shell
 *   - diff + compare UI
 *   - conflict resolution when main has moved ahead of the branch
 *
 * The schema and this service exist so those features can land
 * incrementally without another breaking migration.
 */

export type DraftBranchStatus = "open" | "promoting" | "promoted" | "discarded";

export interface DraftBranch {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  base_change_set_id: string | null;
  created_by: string | null;
  status: DraftBranchStatus;
  created_at: string;
  promoted_at: string | null;
  discarded_at: string | null;
  /** OAuth connection that created this branch via MCP, if any. */
  authored_by_connection_id: string | null;
  /** OAuth client_id that created this branch via MCP, if any. */
  authored_by_client_id: string | null;
}

export type BranchHeadObjectType = "note" | "file" | "skill" | "agent";

export interface BranchHead {
  id: string;
  branch_id: string;
  object_type: BranchHeadObjectType;
  object_id: string;
  version_id: string;
  updated_at: string;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export interface CreateBranchInput {
  workspace_id: string;
  name: string;
  description?: string | null;
  base_change_set_id?: string | null;
  created_by: string;
}

export async function createDraftBranch(
  supabase: SupabaseClient,
  input: CreateBranchInput
): Promise<DraftBranch> {
  const name = input.name.trim();
  if (!name) throw new Error("Branch name is required");
  if (name.length > 200) throw new Error("Branch name must be 200 characters or fewer");

  const { data, error } = await supabase
    .from("draft_branches")
    .insert({
      workspace_id: input.workspace_id,
      name,
      description: input.description ?? null,
      base_change_set_id: input.base_change_set_id ?? null,
      created_by: input.created_by,
      status: "open",
    })
    .select()
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create draft branch");
  }
  return data as DraftBranch;
}

export async function listDraftBranches(
  supabase: SupabaseClient,
  workspaceId: string,
  { status }: { status?: DraftBranchStatus } = {}
): Promise<DraftBranch[]> {
  let q = supabase
    .from("draft_branches")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return (data ?? []) as DraftBranch[];
}

export async function getDraftBranch(
  supabase: SupabaseClient,
  id: string
): Promise<DraftBranch | null> {
  const { data } = await supabase
    .from("draft_branches")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as DraftBranch | null) ?? null;
}

/**
 * Mark a branch discarded. The branch row stays as audit trail;
 * the action caller clears branch_heads and branch-scoped rows.
 */
export async function discardDraftBranch(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("draft_branches")
    .update({ status: "discarded", discarded_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open");
  if (error) throw new Error(error.message);
}

/**
 * Mark a branch promoted. The actual promotion flow is a restore-style
 * operation that copies each branch head onto the canonical
 * current_version_id. This function only records the branch status
 * transition and should be called at the end of that flow.
 */
export async function markBranchPromoted(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("draft_branches")
    .update({ status: "promoted", promoted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open");
  if (error) throw new Error(error.message);
}

// ─── Branch heads ────────────────────────────────────────────────────────────

export interface UpsertBranchHeadInput {
  branch_id: string;
  object_type: BranchHeadObjectType;
  object_id: string;
  version_id: string;
}

export async function upsertBranchHead(
  supabase: SupabaseClient,
  input: UpsertBranchHeadInput
): Promise<BranchHead> {
  const { data, error } = await supabase
    .from("branch_heads")
    .upsert(
      {
        branch_id: input.branch_id,
        object_type: input.object_type,
        object_id: input.object_id,
        version_id: input.version_id,
      },
      { onConflict: "branch_id,object_type,object_id" }
    )
    .select()
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to upsert branch head");
  }
  return data as BranchHead;
}

export async function listBranchHeads(
  supabase: SupabaseClient,
  branchId: string
): Promise<BranchHead[]> {
  const { data } = await supabase
    .from("branch_heads")
    .select("*")
    .eq("branch_id", branchId);
  return (data ?? []) as BranchHead[];
}

/**
 * Given a (workspace, object) resolve the version id that the caller's
 * current branch context points at. When `branchId` is undefined the
 * function returns null to signal "use main". Callers then fall back to
 * the object's canonical current_version_id.
 */
export async function resolveBranchVersion(
  supabase: SupabaseClient,
  branchId: string | null | undefined,
  object_type: BranchHeadObjectType,
  object_id: string
): Promise<string | null> {
  if (!branchId) return null;
  const { data } = await supabase
    .from("branch_heads")
    .select("version_id")
    .eq("branch_id", branchId)
    .eq("object_type", object_type)
    .eq("object_id", object_id)
    .maybeSingle();
  return (data?.version_id as string | undefined) ?? null;
}

// ─── Promote ─────────────────────────────────────────────────────────────────

export interface PromoteBranchResult {
  branchId: string;
  promotedObjects: Array<{ object_type: BranchHeadObjectType; object_id: string; new_version_id: string }>;
  /** Change set that wrapped the promote, for history traceability. */
  changeSetId: string;
}

/**
 * Promote every branch head onto main.
 *
 * For each `branch_heads` row we advance the underlying canonical
 * object's `current_version_id` to the branch's version. The target
 * version is already an immutable row in `note_versions` (or
 * `object_versions` for file/skill/agent), so no new content row is
 * written — only the canonical pointer moves.
 *
 * The whole operation runs inside an `origin: 'branch_promotion'`
 * change set so it shows up in history as one grouped restore-able
 * unit. Restoring the change set reverts the pointer moves — it does
 * not delete the branch heads.
 *
 * Promotes every branch_heads row: notes advance via `note_versions`,
 * and files / skills / agents advance via the shared `object_versions`
 * table (see the per-object-type branch below). Package metadata
 * overlays in `branch_package_metadata` are also merged onto their
 * canonical skills / agents rows in the same change set.
 */
export async function promoteBranch(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  branchId: string
): Promise<PromoteBranchResult> {
  const branch = await getDraftBranch(supabase, branchId);
  if (!branch) throw new Error("Branch not found");
  if (branch.workspace_id !== workspaceId) throw new Error("Branch not in this workspace");
  if (branch.status !== "open") throw new Error(`Branch is ${branch.status}, cannot promote`);

  // Concurrent-promote guard via check-and-swap.
  const { data: casRows, error: casError } = await supabase
    .from("draft_branches")
    .update({ status: "promoting" })
    .eq("id", branchId)
    .eq("status", "open")
    .select("id");
  if (casError) throw new Error(casError.message);
  if (!casRows || casRows.length === 0) {
    throw new Error("Branch promote is already in progress or branch is not open");
  }

  const heads = await listBranchHeads(supabase, branchId);
  if (heads.length === 0) {
    await supabase
      .from("draft_branches")
      .update({ status: "open" })
      .eq("id", branchId)
      .eq("status", "promoting");
    throw new Error("Branch has no heads to promote");
  }

  const { openChangeSet, commitChangeSet, abortChangeSet, recordChangeSetItem } =
    await import("./change_set_service");
  const cs = await openChangeSet(supabase, {
    workspace_id: workspaceId,
    origin: "branch_promotion",
    actor_type: "user",
    actor_id: actorId,
    summary: `Promote branch "${branch.name}"`,
    metadata: {
      branch_id: branchId,
      branch_name: branch.name,
      head_count: heads.length,
    },
  });

  const promoted: PromoteBranchResult["promotedObjects"] = [];

  try {
    for (const head of heads) {
      if (head.object_type === "note") {
        // Read the prior canonical head so we can record a correct
        // before_snapshot for the change set item.
        const { data: note } = await supabase
          .from("notes")
          .select("id, current_version_id, title, markdown_content, content_bytes, summary")
          .eq("id", head.object_id)
          .maybeSingle();
        if (!note) continue;
        const { data: branchVer } = await supabase
          .from("note_versions")
          .select("id, title, markdown_content, content_bytes")
          .eq("id", head.version_id)
          .maybeSingle();
        if (!branchVer) continue;

        await supabase
          .from("notes")
          .update({
            current_version_id: branchVer.id,
            title: branchVer.title,
            markdown_content: branchVer.markdown_content,
            content_bytes: branchVer.content_bytes,
          })
          .eq("id", head.object_id);

        // Tag the promoted version with the change_set_id so history
        // can walk from "branch_promotion change set" → versions.
        await supabase
          .from("note_versions")
          .update({ change_set_id: cs.id })
          .eq("id", branchVer.id);

        await recordChangeSetItem(supabase, {
          change_set_id: cs.id,
          workspace_id: workspaceId,
          operation: "update",
          object_type: "note",
          object_id: head.object_id,
          version_id: branchVer.id,
          before_snapshot: { version_id: note.current_version_id ?? null },
          after_snapshot: { version_id: branchVer.id, branch_id: branchId },
        });

        promoted.push({
          object_type: "note",
          object_id: head.object_id,
          new_version_id: branchVer.id,
        });
      } else if (
        head.object_type === "file" ||
        head.object_type === "skill" ||
        head.object_type === "agent"
      ) {
        // File / skill / agent heads share one shape — the canonical
        // table's `current_version_id` advances to the branch head
        // version and the versioned content fields mirror onto the
        // row, matching the Notes promote path. Non-versioned
        // columns (name, description, tags, status, is_reusable,
        // canonical_format, …) stay as-is because branches never
        // touched them.
        const table =
          head.object_type === "file" ? "files" :
          head.object_type === "skill" ? "skills" : "agents";

        const { data: row } = await supabase
          .from(table)
          .select("id, current_version_id, source_content, content_bytes")
          .eq("id", head.object_id)
          .maybeSingle();
        if (!row) continue;
        const { data: branchVer } = await supabase
          .from("object_versions")
          .select("id, source_content, content_bytes")
          .eq("id", head.version_id)
          .maybeSingle();
        if (!branchVer) continue;

        await supabase
          .from(table)
          .update({
            current_version_id: branchVer.id,
            source_content: branchVer.source_content,
            content_bytes: branchVer.content_bytes,
          })
          .eq("id", head.object_id);

        // Tag the promoted version with the change_set_id so the
        // rollback engine can walk branch_promotion → versions.
        await supabase
          .from("object_versions")
          .update({ change_set_id: cs.id })
          .eq("id", branchVer.id);

        await recordChangeSetItem(supabase, {
          change_set_id: cs.id,
          workspace_id: workspaceId,
          operation: "update",
          object_type: head.object_type,
          object_id: head.object_id,
          version_id: branchVer.id,
          before_snapshot: { version_id: row.current_version_id ?? null },
          after_snapshot: { version_id: branchVer.id, branch_id: branchId },
        });

        promoted.push({
          object_type: head.object_type,
          object_id: head.object_id,
          new_version_id: branchVer.id,
        });
      }
    }

    // Apply any package metadata overlays (description / tags /
    // summary / agent_type / model_hint / system_prompt) onto the
    // canonical skills / agents rows. The overlay rows themselves
    // are left in place as audit trail — the branch is marked
    // promoted below, which is what hides the overlay from active
    // reads.
    const { data: overlays } = await supabase
      .from("branch_package_metadata")
      .select("package_type, package_id, name, description, tags, summary, agent_type, model_hint, system_prompt")
      .eq("branch_id", branchId);

    for (const ov of overlays ?? []) {
      const table = ov.package_type === "skill" ? "skills" : "agents";
      const legalFields = ov.package_type === "skill"
        ? ["name", "description", "tags", "summary"]
        : ["name", "description", "tags", "summary", "agent_type", "model_hint", "system_prompt"];
      const patch: Record<string, unknown> = {};
      for (const f of legalFields) {
        const v = (ov as Record<string, unknown>)[f];
        if (v !== undefined) patch[f] = v; // include explicit nulls
      }
      if (Object.keys(patch).length === 0) continue;

      // Read main's prior values for the audit snapshot. Keeps the
      // change_set_item's before_snapshot useful for restore.
      const { data: before } = await supabase
        .from(table)
        .select("id, " + legalFields.join(", "))
        .eq("id", ov.package_id)
        .maybeSingle();

      await supabase
        .from(table)
        .update(patch)
        .eq("id", ov.package_id);

      // Keep the denormalized `workspace_objects.display_name` in sync
      // when the overlay renamed the package. Without this sync the
      // workspace-wide listing would keep showing the pre-promote
      // name even though the canonical row is updated.
      if (
        "name" in patch &&
        patch.name !== null &&
        patch.name !== undefined &&
        typeof patch.name === "string"
      ) {
        await supabase
          .from("workspace_objects")
          .update({ display_name: patch.name })
          .eq("object_type", ov.package_type)
          .eq("object_id", ov.package_id);
      }

      await recordChangeSetItem(supabase, {
        change_set_id: cs.id,
        workspace_id: workspaceId,
        operation: "update",
        object_type: ov.package_type as "skill" | "agent",
        object_id: ov.package_id,
        before_snapshot: { metadata: before ?? {} },
        after_snapshot: { metadata: patch, from_branch: branchId },
      });

      promoted.push({
        object_type: ov.package_type as "skill" | "agent",
        object_id: ov.package_id,
        // No new version is created for a metadata-only promotion —
        // reuse the existing current_version_id on the row. The
        // object's version graph is untouched.
        new_version_id: "",
      });
    }

    // Promote any branch-scoped structural rows onto main. `files`
    // and `object_links` both use a nullable `branch_id` column:
    // clearing it lands the row on main. We record a `change_set_item`
    // per promoted row so the rollback engine can revert.
    const { data: branchFiles } = await supabase
      .from("files")
      .select("id, name, box_id, parent_skill_id, parent_agent_id")
      .eq("branch_id", branchId);
    for (const f of branchFiles ?? []) {
      await supabase.from("files").update({ branch_id: null }).eq("id", f.id);
      await recordChangeSetItem(supabase, {
        change_set_id: cs.id,
        workspace_id: workspaceId,
        operation: "create",
        object_type: "file",
        object_id: f.id,
        before_snapshot: { branch_id: branchId },
        after_snapshot: {
          branch_id: null,
          box_id: f.box_id,
          parent_skill_id: f.parent_skill_id ?? null,
          parent_agent_id: f.parent_agent_id ?? null,
          promoted_from_branch: branchId,
        },
      });
      promoted.push({
        object_type: "file" as const,
        object_id: f.id,
        new_version_id: "",
      });
    }

    const { data: branchLinks } = await supabase
      .from("object_links")
      .select("id, source_object_type, source_object_id, target_object_type, target_object_id, relationship_type")
      .eq("branch_id", branchId);
    for (const link of branchLinks ?? []) {
      await supabase
        .from("object_links")
        .update({ branch_id: null })
        .eq("id", link.id);
      await recordChangeSetItem(supabase, {
        change_set_id: cs.id,
        workspace_id: workspaceId,
        operation: "link_create",
        object_type: "object_link",
        object_id: link.id,
        before_snapshot: { branch_id: branchId },
        after_snapshot: {
          source_object_type: link.source_object_type,
          source_object_id: link.source_object_id,
          target_object_type: link.target_object_type,
          target_object_id: link.target_object_id,
          relationship_type: link.relationship_type,
          promoted_from_branch: branchId,
        },
      });
    }

    // Promote branch-scoped note_links — same shape as object_links.
    // Main readers ignore non-null branch_id; clearing it lands the
    // row onto main. Records a link_create change_set_item so the
    // rollback engine can revert to a branch-state row.
    const { data: branchNoteLinks } = await supabase
      .from("note_links")
      .select("id, source_note_id, target_note_id, relationship_type")
      .eq("branch_id", branchId);
    for (const nl of branchNoteLinks ?? []) {
      await supabase
        .from("note_links")
        .update({ branch_id: null })
        .eq("id", nl.id);
      await recordChangeSetItem(supabase, {
        change_set_id: cs.id,
        workspace_id: workspaceId,
        operation: "link_create",
        object_type: "note_link",
        object_id: nl.id,
        before_snapshot: { branch_id: branchId },
        after_snapshot: {
          source_note_id: nl.source_note_id,
          target_note_id: nl.target_note_id,
          relationship_type: nl.relationship_type,
          promoted_from_branch: branchId,
        },
      });
    }

    // Promote branch-scoped box_object_attachments. Attachment rows
    // are reference-only (no lifecycle / versioning), so a promote
    // just clears branch_id so main readers see the row. The
    // change_set_item uses operation='attach' to match the main
    // attach path's audit.
    const { data: branchAttachments } = await supabase
      .from("box_object_attachments")
      .select("id, box_id, folder_id, object_type, object_id, sort_order")
      .eq("branch_id", branchId);
    for (const att of branchAttachments ?? []) {
      await supabase
        .from("box_object_attachments")
        .update({ branch_id: null })
        .eq("id", att.id);
      await recordChangeSetItem(supabase, {
        change_set_id: cs.id,
        workspace_id: workspaceId,
        operation: "attach",
        object_type: "box_object_attachment",
        object_id: att.id,
        before_snapshot: { branch_id: branchId },
        after_snapshot: {
          box_id: att.box_id,
          folder_id: att.folder_id,
          object_type: att.object_type,
          object_id: att.object_id,
          sort_order: att.sort_order,
          promoted_from_branch: branchId,
        },
      });
    }

    // Promote branch-scoped notes, folders, and boxes. Same pattern
    // as files / object_links: clear branch_id so the row becomes
    // main, and record a change_set_item so the rollback engine can
    // revert. Structural identity (box_id, folder_id, etc.) survives
    // the promotion unchanged.
    for (const table of ["notes", "folders", "boxes"] as const) {
      const { data: rows } = await supabase
        .from(table)
        .select("id")
        .eq("branch_id", branchId);
      for (const row of rows ?? []) {
        await supabase
          .from(table)
          .update({ branch_id: null })
          .eq("id", row.id);
        await recordChangeSetItem(supabase, {
          change_set_id: cs.id,
          workspace_id: workspaceId,
          operation: "create",
          object_type: table === "notes" ? "note" : table === "folders" ? "folder" : "box",
          object_id: row.id,
          before_snapshot: { branch_id: branchId },
          after_snapshot: { branch_id: null, promoted_from_branch: branchId },
        });
      }
    }

    // Apply box metadata overlays — renames / description edits
    // recorded against main box rows. Mirrors the package metadata
    // overlay path; promoteBoxOverlays also keeps the denormalized
    // workspace_objects.display_name in sync on rename.
    const { promoteBoxOverlays } = await import(
      "./box_branch_metadata_service"
    );
    const boxOverlayChanges = await promoteBoxOverlays(supabase, branchId);
    for (const ch of boxOverlayChanges) {
      await recordChangeSetItem(supabase, {
        change_set_id: cs.id,
        workspace_id: workspaceId,
        operation: "update",
        object_type: "box",
        object_id: ch.boxId,
        before_snapshot: { metadata: ch.before, branch_id: branchId },
        after_snapshot: { metadata: ch.after },
      });
    }

    // Apply folder-branch overrides — rename / reparent / reorder
    // intents recorded against main folder rows. Each promoted
    // override becomes a change_set_item so the rollback engine can
    // revert. See `folder_branch_service.promoteFolderOverrides`.
    const { promoteFolderOverrides } = await import(
      "./folder_branch_service"
    );
    const folderChanges = await promoteFolderOverrides(supabase, branchId);
    for (const ch of folderChanges) {
      if (
        Object.keys(ch.before).length === 0 &&
        Object.keys(ch.after).length === 0
      ) {
        continue; // empty overlay — nothing to record
      }
      await recordChangeSetItem(supabase, {
        change_set_id: cs.id,
        workspace_id: workspaceId,
        operation: "update",
        object_type: "folder",
        object_id: ch.folderId,
        before_snapshot: { ...ch.before, branch_id: branchId },
        after_snapshot: { ...ch.after, promoted_from_branch: branchId },
      });
      promoted.push({
        object_type: "folder" as unknown as BranchHeadObjectType,
        object_id: ch.folderId,
        new_version_id: "",
      });
    }

    // Apply placement overrides — sort_order + folder_id intents
    // recorded by drag-and-drop reorder/move on the branch. Each
    // promoted overlay becomes a change_set_item with operation
    // 'move' when folder_id changed and 'update' when only the
    // sort_order changed. See `placement_branch_service`.
    const { promotePlacementOverrides } = await import(
      "./placement_branch_service"
    );
    const placementChanges = await promotePlacementOverrides(supabase, branchId);
    for (const ch of placementChanges) {
      if (
        Object.keys(ch.before).length === 0 &&
        Object.keys(ch.after).length === 0
      ) {
        continue;
      }
      const hadFolderChange = Object.prototype.hasOwnProperty.call(
        ch.after,
        "folder_id"
      );
      const op = hadFolderChange ? ("move" as const) : ("update" as const);
      // Placement overlays for native objects address the
      // workspace_objects PK as `target_id`, but the change_set_item
      // object_type CHECK only accepts leaf types + `folder`, `box`,
      // `box_object_attachment`. Map workspace_object overlays to
      // their inner object_type (note/file/folder/skill/agent) when
      // we have it; fall back to `box_object_attachment` otherwise.
      const itemObjectType =
        ch.targetType === "box_object_attachment"
          ? "box_object_attachment"
          : (ch.objectType ?? "box_object_attachment");
      const itemObjectId = ch.objectId ?? ch.targetId;
      await recordChangeSetItem(supabase, {
        change_set_id: cs.id,
        workspace_id: workspaceId,
        operation: op,
        object_type: itemObjectType as
          | "note"
          | "file"
          | "skill"
          | "agent"
          | "folder"
          | "box"
          | "note_link"
          | "object_link"
          | "box_object_attachment",
        object_id: itemObjectId,
        before_snapshot: { ...ch.before, branch_id: branchId },
        after_snapshot: { ...ch.after, promoted_from_branch: branchId },
      });
    }

    // Apply pending structural ops (trash / archive / unarchive /
    // move / detach against main rows). Each op becomes a
    // change_set_item so the rollback engine can revert. Ops are
    // applied in the order they were recorded — later ops override
    // earlier ones on the same target.
    const { listPendingOps, applyPendingOp } = await import(
      "./pending_op_service"
    );
    const pending = await listPendingOps(supabase, branchId);
    for (const op of pending) {
      const result = await applyPendingOp(supabase, op);
      const opToItemOp =
        op.op_type === "trash" ? "trash" as const :
        op.op_type === "archive" ? "archive" as const :
        op.op_type === "unarchive" ? "unarchive" as const :
        op.op_type === "detach" ? "detach" as const :
        "move" as const;
      await recordChangeSetItem(supabase, {
        change_set_id: cs.id,
        workspace_id: workspaceId,
        operation: opToItemOp,
        object_type: op.object_type === "object_link" || op.object_type === "box_object_attachment"
          ? op.object_type
          : op.object_type,
        object_id: op.object_id,
        before_snapshot: { ...result.before, branch_id: branchId, pending_op: op.op_type },
        after_snapshot: { ...result.after, promoted_from_branch: branchId },
      });
    }

    await commitChangeSet(supabase, cs.id);
    const { error: promotedErr } = await supabase
      .from("draft_branches")
      .update({ status: "promoted", promoted_at: new Date().toISOString() })
      .eq("id", branchId)
      .eq("status", "promoting");
    if (promotedErr) throw new Error(promotedErr.message);

    return { branchId, promotedObjects: promoted, changeSetId: cs.id };
  } catch (err) {
    await abortChangeSet(
      supabase,
      cs.id,
      err instanceof Error ? err.message : "promote failed"
    ).catch(() => {});
    await supabase
      .from("draft_branches")
      .update({ status: "open" })
      .eq("id", branchId)
      .eq("status", "promoting");
    throw err;
  }
}
