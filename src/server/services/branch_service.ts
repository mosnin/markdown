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

export type DraftBranchStatus = "open" | "promoted" | "discarded";

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
 * Mark a branch discarded. Branch heads are left intact as an audit
 * trail; readers ignore discarded branches. No content is deleted.
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
 * V1 scope: notes only. Files / skills / agents use the same
 * mechanism but their write path isn't yet wired; once it is, this
 * function extends by iterating their branch_heads rows with the
 * same pattern.
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

  const heads = await listBranchHeads(supabase, branchId);
  if (heads.length === 0) {
    // Nothing to promote. Mark the branch promoted anyway so the
    // draft state is cleaned up; the caller can report "nothing to
    // promote" if useful.
    await markBranchPromoted(supabase, branchId);
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
      }
      // file / skill / agent branch writes aren't wired yet (see
      // note in updateNoteOnBranch). When they land, add the same
      // advance-the-current_version_id pattern against `files` /
      // `skills` / `agents` here.
    }

    await commitChangeSet(supabase, cs.id);
    await markBranchPromoted(supabase, branchId);

    return { branchId, promotedObjects: promoted, changeSetId: cs.id };
  } catch (err) {
    await abortChangeSet(
      supabase,
      cs.id,
      err instanceof Error ? err.message : "promote failed"
    ).catch(() => {});
    throw err;
  }
}
