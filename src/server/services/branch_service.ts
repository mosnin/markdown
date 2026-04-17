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

export type DraftBranchStatus =
  | "open"
  | "promoting"
  | "promoted"
  | "discarded"
  | "rolled_back";

/**
 * Review gate on a draft branch. Source of truth read by
 * {@link promoteBranch} to decide whether a branch may land.
 *
 * Transitions are driven by `branch_review_service`:
 *
 *   draft ──request──▶ review_requested
 *   review_requested ──approve──▶ approved
 *   review_requested ──reject──▶ changes_requested
 *   approved / changes_requested ──reset──▶ review_requested | draft
 *
 * 'draft' is the pre-review "author going solo" state — promote is
 * allowed. 'approved' passes. 'review_requested' and
 * 'changes_requested' both block promote with a clear error; the
 * author resolves via the review actions.
 */
export type BranchReviewStatus =
  | "draft"
  | "review_requested"
  | "approved"
  | "changes_requested";

export interface DraftBranch {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  base_change_set_id: string | null;
  created_by: string | null;
  status: DraftBranchStatus;
  /**
   * Review gate state. Defaults to 'draft' for newly created branches
   * in the migration. See {@link BranchReviewStatus}.
   */
  review_status: BranchReviewStatus;
  created_at: string;
  promoted_at: string | null;
  discarded_at: string | null;
  rolled_back_at: string | null;
  rollback_change_set_id: string | null;
  /** OAuth connection that created this branch via MCP, if any. */
  authored_by_connection_id: string | null;
  /** OAuth client_id that created this branch via MCP, if any. */
  authored_by_client_id: string | null;
  /**
   * Lifecycle instrumentation (Feature #8 — branch auto-cleanup).
   * Nullable so callers reading rows written before the
   * `20260414000004_branch_lifecycle` migration still typecheck.
   */
  last_activity_at: string | null;
  last_warned_at: string | null;
  warning_count: number;
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
  // Branch-activity touch (Feature #8). Errors are swallowed so a
  // lifecycle-table failure never blocks the content write.
  try {
    const { touchBranchActivity } = await import("./branch_lifecycle_service");
    await touchBranchActivity(supabase, input.branch_id, "");
  } catch {
    // swallowed on purpose
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
  /**
   * Webhook gate runs that fired before the promote. Empty when the
   * workspace has no active gates or when the caller set
   * {@link PromoteBranchOptions.skip_gates}. Populated so the action
   * layer can echo the pass/fail matrix back to the UI.
   */
  gateRuns?: Array<{
    gate_id: string;
    gate_name: string;
    status: "pending" | "passed" | "failed" | "error" | "timeout";
    reason: string | null;
  }>;
  /** True when the caller elected to bypass gates (admin override). */
  gatesSkipped?: boolean;
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

/**
 * Progress event emitted by {@link promoteBranch} when an
 * `onProgress` callback is provided. Consumers (e.g. the SSE
 * streaming endpoint) serialise these as newline-delimited JSON.
 */
export type PromoteProgressEvent =
  | { step: "gates"; status: "running" }
  | {
      step: "gates";
      status: "passed";
      results: Array<{
        gate_id: string;
        gate_name: string;
        status: string;
        reason: string | null;
      }>;
    }
  | { step: "gates"; status: "skipped" }
  | { step: "promoting"; current: number; total: number; object_type: string }
  | { step: "done"; change_set_id: string }
  | { step: "error"; message: string };

export interface PromoteBranchOptions {
  /**
   * When true, skip the unresolved-comments gate. The review-status
   * gate still applies — force does not bypass `changes_requested` /
   * `review_requested`. Callers should role-gate this upstream
   * (admin-only) since it overrides the "all threads resolved"
   * invariant.
   */
  force?: boolean;
  /**
   * Admin override: skip the pre-promote webhook gate run. The branch
   * row still moves through the CAS guard and the change-set flow
   * exactly as for a normal promote. The override is audited with
   * the `branch.promotion_gates_skipped` event type by the action
   * layer. Caller must role-gate upstream.
   */
  skip_gates?: boolean;
  /**
   * Condensed diff handed to each webhook. Computed by the action
   * layer via `branch_diff_service.getBranchDiff`. When undefined
   * (e.g. a programmatic caller), the gate payload falls back to a
   * minimal summary built from the branch heads.
   */
  gate_diff_summary?: import("./branch_promotion_gate_service").GateDiffSummary;
  /**
   * Cherry-pick subset. When provided, only the listed
   * `(objectType, objectId)` pairs are promoted — every other branch
   * head / overlay / pending op / branch-local row stays on the
   * branch for a future promote. The selection applies uniformly
   * across ALL overlay kinds that address an object by `(type, id)`:
   *
   *   - branch_heads (note / file / skill / agent)
   *   - branch_package_metadata (skill / agent)
   *   - box_branch_metadata_overlay (box)
   *   - branch_folder_overrides (folder)
   *   - branch_placement_overrides — matched by the overlay's inner
   *     (object_type, object_id) for workspace_object overlays, and
   *     by (`box_object_attachment`, target_id) for attachment
   *     overlays since attachments are their own object identity
   *   - branch_pending_ops (by target object's type + id)
   *   - branch-local rows on files / object_links / note_links /
   *     box_object_attachments / notes / folders / boxes (matched by
   *     their native object_type + their row id)
   *
   * When the partial promote leaves any unpromoted branch head /
   * overlay / branch-local row behind, the branch status stays
   * `open`. Only when the selection covers everything does it flip
   * to `promoted`. The change_set origin is `'branch_promotion_partial'`
   * rather than `'branch_promotion'` so history + rollback can
   * distinguish the two.
   *
   * Passing `undefined` (or omitting) runs the full-promote path,
   * identical to pre-cherry-pick behavior.
   */
  selectedObjects?: ReadonlyArray<{ objectType: string; objectId: string }>;
  /**
   * Optional progress callback. When provided, the promote flow
   * emits {@link PromoteProgressEvent} objects at key milestones.
   * The callback is fire-and-forget — errors thrown inside it are
   * swallowed so they never derail the promote transaction.
   */
  onProgress?: (event: PromoteProgressEvent) => void;
}

export async function promoteBranch(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  branchId: string,
  options: PromoteBranchOptions = {}
): Promise<PromoteBranchResult> {
  // Fire-and-forget progress emitter. Swallows errors so a broken
  // callback never derails the promote transaction.
  const emit = (event: PromoteProgressEvent): void => {
    if (!options.onProgress) return;
    try {
      options.onProgress(event);
    } catch {
      /* swallowed */
    }
  };

  const branch = await getDraftBranch(supabase, branchId);
  if (!branch) throw new Error("Branch not found");
  if (branch.workspace_id !== workspaceId) throw new Error("Branch not in this workspace");
  if (branch.status !== "open") throw new Error(`Branch is ${branch.status}, cannot promote`);

  // Review gate. 'draft' (no review was requested — author going
  // solo) and 'approved' both pass. The two pending states block
  // promote with a clear error the UI surfaces next to the button.
  if (
    branch.review_status === "review_requested" ||
    branch.review_status === "changes_requested"
  ) {
    throw new Error(
      `Cannot promote: review_status is ${branch.review_status}. At least one approval required.`
    );
  }

  // Unresolved-comments gate. Callers can override with { force: true }
  // (admin-only at the action layer). The count query is cheap and
  // short-circuits before we open a change set.
  //
  // For partial promotes (cherry-pick), only count unresolved comments
  // on the selected objects — unrelated threads should not block a
  // cherry-pick of objects that have no open comments.
  if (!options.force) {
    const { countUnresolvedComments } = await import(
      "./branch_comment_service"
    );
    const commentFilter = options.selectedObjects
      ? options.selectedObjects.map((s) => ({
          objectType: s.objectType,
          objectId: s.objectId,
        }))
      : undefined;
    const unresolvedCount = await countUnresolvedComments(
      supabase,
      branchId,
      commentFilter
    );
    if (unresolvedCount > 0) {
      throw new Error(
        `Cannot promote: ${unresolvedCount} unresolved comment${unresolvedCount === 1 ? "" : "s"} on this branch. Resolve all threads or retry with force.`
      );
    }
  }

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

  // ── Webhook gate run ────────────────────────────────────────────────────
  // Fires after the CAS guard so a losing concurrent promote doesn't
  // burn webhook budget, and before we open the change set so a fail
  // cleanly rolls the status back to 'open' without needing an abort.
  let gateRunsReport: PromoteBranchResult["gateRuns"];
  let gatesSkipped = false;
  if (options.skip_gates) {
    gatesSkipped = true;
    emit({ step: "gates", status: "skipped" });
  } else {
    emit({ step: "gates", status: "running" });
    const { runGates, GatePromotionError } = await import(
      "./branch_promotion_gate_service"
    );
    const diffSummary = options.gate_diff_summary ?? {
      head_count: 0,
      pending_op_count: 0,
      folder_override_count: 0,
      placement_change_count: 0,
      created_note_link_count: 0,
      created_attachment_count: 0,
      changed_objects: [],
    };
    const gateResult = await runGates(
      supabase,
      workspaceId,
      branchId,
      branch.name,
      diffSummary
    );
    gateRunsReport = gateResult.runs.map((r) => ({
      gate_id: r.gate_id,
      gate_name: r.gate_name,
      status: r.status,
      reason: r.response_body,
    }));
    emit({
      step: "gates",
      status: "passed",
      results: gateRunsReport.map((r) => ({
        ...r,
        status: String(r.status),
      })),
    });
    if (!gateResult.allPassed) {
      // Roll the CAS back to 'open' so the user can fix the gate and
      // retry. We do NOT open a change set, so there is nothing to
      // abort — the gate run rows themselves are the audit trail.
      await supabase
        .from("draft_branches")
        .update({ status: "open" })
        .eq("id", branchId)
        .eq("status", "promoting");
      const failed = gateResult.runs.filter((r) => r.status !== "passed");
      throw new GatePromotionError(
        failed.map((f) => ({
          gate_id: f.gate_id,
          gate_name: f.gate_name,
          status: f.status,
          reason: f.response_body,
        }))
      );
    }
  }

  const allHeads = await listBranchHeads(supabase, branchId);

  // Cherry-pick selection lookup. The full-promote path leaves this
  // set null so `isSelected` short-circuits to true for every key.
  // When the caller supplies a non-empty selection, keys are
  // normalized to `${type}:${id}` so lookups across every overlay
  // kind cost O(1).
  const isPartial = options.selectedObjects !== undefined;
  const selectedKeys: Set<string> | null = isPartial
    ? new Set(
        (options.selectedObjects ?? []).map(
          (s) => `${s.objectType}:${s.objectId}`
        )
      )
    : null;
  const isSelected = (objectType: string, objectId: string): boolean =>
    selectedKeys === null || selectedKeys.has(`${objectType}:${objectId}`);

  // Filter heads up front so every downstream guard ("has heads?",
  // "iterate heads") sees the cherry-picked view and the full-promote
  // path continues to see every head.
  const heads = selectedKeys
    ? allHeads.filter((h) => isSelected(h.object_type, h.object_id))
    : allHeads;

  // The "nothing to promote" gate needs to check every change kind
  // the partial path covers — just looking at heads would reject
  // overlay-only selections (e.g. cherry-picking a box rename).
  if (heads.length === 0 && isPartial) {
    // Fall through: we still want to check overlays/pending ops
    // against the selection and may find something to apply.
  } else if (heads.length === 0) {
    await supabase
      .from("draft_branches")
      .update({ status: "open" })
      .eq("id", branchId)
      .eq("status", "promoting");
    throw new Error("Branch has no heads to promote");
  }

  if (isPartial && selectedKeys!.size === 0) {
    await supabase
      .from("draft_branches")
      .update({ status: "open" })
      .eq("id", branchId)
      .eq("status", "promoting");
    throw new Error("Partial promote requires at least one selected object");
  }

  const { openChangeSet, commitChangeSet, abortChangeSet, recordChangeSetItem } =
    await import("./change_set_service");
  const cs = await openChangeSet(supabase, {
    workspace_id: workspaceId,
    origin: isPartial ? "branch_promotion_partial" : "branch_promotion",
    actor_type: "user",
    actor_id: actorId,
    summary: isPartial
      ? `Partial promote from branch "${branch.name}"`
      : `Promote branch "${branch.name}"`,
    metadata: {
      branch_id: branchId,
      branch_name: branch.name,
      head_count: heads.length,
      ...(isPartial
        ? {
            promoted_objects: Array.from(selectedKeys!).map((k) => {
              const idx = k.indexOf(":");
              return { object_type: k.slice(0, idx), object_id: k.slice(idx + 1) };
            }),
          }
        : {}),
    },
  });

  const promoted: PromoteBranchResult["promotedObjects"] = [];

  try {
    // ── Promote branch heads (notes + file/skill/agent) ─────────────
    let headIdx = 0;
    for (const head of heads) {
      headIdx++;
      emit({
        step: "promoting",
        current: headIdx,
        total: heads.length,
        object_type: head.object_type,
      });
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
      // Cherry-pick gate: the package must be in the selection to
      // promote its overlay. Matches by (skill|agent):<package_id>.
      if (!isSelected(ov.package_type as string, ov.package_id as string)) continue;
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
      if (!isSelected("file", f.id)) continue;
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
      if (!isSelected("object_link", link.id)) continue;
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
      if (!isSelected("note_link", nl.id)) continue;
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
      if (!isSelected("box_object_attachment", att.id)) continue;
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
        const itemObjectType =
          table === "notes" ? "note" : table === "folders" ? "folder" : "box";
        if (!isSelected(itemObjectType, row.id)) continue;
        await supabase
          .from(table)
          .update({ branch_id: null })
          .eq("id", row.id);
        await recordChangeSetItem(supabase, {
          change_set_id: cs.id,
          workspace_id: workspaceId,
          operation: "create",
          object_type: itemObjectType,
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
    const boxOverlayChanges = await promoteBoxOverlays(
      supabase,
      branchId,
      selectedKeys ? (boxId) => isSelected("box", boxId) : undefined
    );
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
    const folderChanges = await promoteFolderOverrides(
      supabase,
      branchId,
      selectedKeys ? (folderId) => isSelected("folder", folderId) : undefined
    );
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
    const placementChanges = await promotePlacementOverrides(
      supabase,
      branchId,
      selectedKeys
        ? (ov) => {
            // Workspace-object overlays resolve to their inner
            // (object_type, object_id) for cherry-pick identity;
            // attachment overlays use ('box_object_attachment',
            // target_id) since attachments are their own objects.
            if (ov.target_type === "box_object_attachment") {
              return isSelected("box_object_attachment", ov.target_id);
            }
            if (ov.object_type && ov.object_id) {
              return isSelected(ov.object_type, ov.object_id);
            }
            // Missing inner identity — can't tell which object, skip
            // defensively under partial-promote so we don't accidentally
            // promote orphan overlays without user consent.
            return false;
          }
        : undefined
    );
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
      // Partial promote only applies pending ops whose target object
      // is in the selection; others stay on the branch for later.
      if (!isSelected(op.object_type, op.object_id)) continue;
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

    // Status flip. Full-promote (no selection) always lands on
    // 'promoted'. Partial-promote lands on 'promoted' only if the
    // selection covered every head / overlay / pending op /
    // branch-local row — i.e., nothing is left to promote. If any
    // unpromoted work remains, the branch stays 'open' so the
    // author can continue editing or promote the rest later.
    let finalStatus: "promoted" | "open" = "promoted";
    if (isPartial) {
      const remaining = await countUnpromotedForBranch(supabase, branchId);
      finalStatus = remaining === 0 ? "promoted" : "open";
    }
    const patch: Record<string, unknown> =
      finalStatus === "promoted"
        ? { status: "promoted", promoted_at: new Date().toISOString() }
        : { status: "open" };
    const { error: promotedErr } = await supabase
      .from("draft_branches")
      .update(patch)
      .eq("id", branchId)
      .eq("status", "promoting");
    if (promotedErr) throw new Error(promotedErr.message);

    emit({ step: "done", change_set_id: cs.id });

    return {
      branchId,
      promotedObjects: promoted,
      changeSetId: cs.id,
      gateRuns: gateRunsReport,
      gatesSkipped,
    };
  } catch (err) {
    emit({
      step: "error",
      message: err instanceof Error ? err.message : "promote failed",
    });
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

/**
 * Count the number of "still unpromoted" artifacts on a branch
 * after a partial promote has committed. Used to decide whether to
 * flip the branch to 'promoted' or keep it 'open' for a follow-up
 * cherry-pick.
 *
 * Counts every overlay kind the partial-promote path clears:
 *
 *   - `branch_heads`             — content edits still pending
 *   - `branch_package_metadata`  — skill / agent metadata overlays
 *   - `box_branch_metadata_overlay`
 *   - `branch_folder_overrides`
 *   - `branch_placement_overrides`
 *   - unapplied `branch_pending_ops`
 *   - branch-local rows on `files`, `object_links`, `note_links`,
 *     `box_object_attachments`, `notes`, `folders`, `boxes`
 *
 * Returns the total row count across every table. Zero means every
 * intent on the branch has been promoted and the branch can flip to
 * 'promoted'. The exact count isn't surfaced to callers — it's only
 * used as an "is anything left" boolean — but it's returned as a
 * number so tests can assert against it directly.
 */
export async function countUnpromotedForBranch(
  supabase: SupabaseClient,
  branchId: string
): Promise<number> {
  let total = 0;
  const tables: Array<{ table: string; filter: "branch_id" }> = [
    { table: "branch_heads", filter: "branch_id" },
    { table: "branch_package_metadata", filter: "branch_id" },
    { table: "box_branch_metadata_overlay", filter: "branch_id" },
    { table: "branch_folder_overrides", filter: "branch_id" },
    { table: "branch_placement_overrides", filter: "branch_id" },
    { table: "files", filter: "branch_id" },
    { table: "object_links", filter: "branch_id" },
    { table: "note_links", filter: "branch_id" },
    { table: "box_object_attachments", filter: "branch_id" },
    { table: "notes", filter: "branch_id" },
    { table: "folders", filter: "branch_id" },
    { table: "boxes", filter: "branch_id" },
  ];
  for (const { table } of tables) {
    const { count } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("branch_id", branchId);
    total += count ?? 0;
  }
  // Pending ops: only count rows that haven't been applied yet, to
  // mirror `listPendingOps`'s read filter.
  const { count: pendingCount } = await supabase
    .from("branch_pending_ops")
    .select("*", { count: "exact", head: true })
    .eq("branch_id", branchId)
    .is("applied_at", null);
  total += pendingCount ?? 0;
  return total;
}
