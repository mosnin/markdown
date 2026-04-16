"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWriteRoleResult } from "@/server/auth/require_role";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import {
  ACTIVE_BRANCH_COOKIE,
} from "@/server/auth/get_request_context";
import {
  createDraftBranch,
  discardDraftBranch,
  promoteBranch,
  listDraftBranches,
  listBranchHeads,
  type DraftBranch,
  type BranchHead,
  type PromoteBranchResult,
} from "@/server/services/branch_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Server actions for draft-branch management.
 *
 * Any write-capable workspace role can create, edit, promote, or
 * discard a branch they can see. Viewers are rejected at the
 * role-gate level. The active branch is persisted in a cookie
 * (`active_branch_id`) so the editor layer routes writes through
 * branch heads automatically when the user is "on" a branch.
 */

// ─── Read ────────────────────────────────────────────────────────────────────

export async function listBranchesAction(): Promise<
  ActionResult<Array<DraftBranch & { head_count: number }>>
> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const branches = await listDraftBranches(supabase, ctx.workspace.id);
    const withCounts: Array<DraftBranch & { head_count: number }> = [];
    for (const b of branches) {
      const heads = await listBranchHeads(supabase, b.id);
      withCounts.push({ ...b, head_count: heads.length });
    }
    return { ok: true, data: withCounts };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to list branches" };
  }
}

export async function getActiveBranchAction(): Promise<
  ActionResult<{ branchId: string | null }>
> {
  try {
    const ctx = await requireAuthenticatedUser();
    return { ok: true, data: { branchId: ctx.activeBranchId } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function getBranchHeadsAction(branchId: string): Promise<
  ActionResult<BranchHead[]>
> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const { data: branch } = await supabase
      .from("draft_branches")
      .select("workspace_id")
      .eq("id", branchId)
      .maybeSingle();
    if (!branch || branch.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Branch not found" };
    }
    const heads = await listBranchHeads(supabase, branchId);
    return { ok: true, data: heads };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

// ─── Switch ──────────────────────────────────────────────────────────────────

/**
 * Set (or clear) the caller's active draft branch.
 *
 * Writes the `active_branch_id` cookie. Pass `null` to clear and
 * return to writing against main. The next render of any route that
 * reads from `getRequestContext()` picks up the new active branch.
 */
export async function setActiveBranchAction(
  branchId: string | null
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    if (branchId) {
      const supabase = await createClient();
      const { data: branch } = await supabase
        .from("draft_branches")
        .select("workspace_id, status")
        .eq("id", branchId)
        .maybeSingle();
      if (!branch || branch.workspace_id !== ctx.workspace.id || branch.status !== "open") {
        return { ok: false, error: "Branch not found or not open" };
      }
    }
    const cookieStore = await cookies();
    if (branchId) {
      cookieStore.set(ACTIVE_BRANCH_COOKIE, branchId, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
      });
    } else {
      cookieStore.delete(ACTIVE_BRANCH_COOKIE);
    }
    revalidatePath("/app");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createBranchAction(
  name: string,
  description?: string | null
): Promise<ActionResult<{ id: string; name: string }>> {
  const gate = await requireWriteRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Branch name is required" };
  if (trimmed.length > 200) return { ok: false, error: "Branch name is too long" };

  try {
    const supabase = await createClient();
    const branch = await createDraftBranch(supabase, {
      workspace_id: ctx.workspace.id,
      name: trimmed,
      description: description?.trim() || null,
      created_by: ctx.user.id,
    });

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "draft_branch",
      object_id: branch.id,
      event_type: "branch.created",
      metadata: { name: branch.name },
    });

    revalidatePath("/app/branches");
    return { ok: true, data: { id: branch.id, name: branch.name } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create branch" };
  }
}

// ─── Promote ─────────────────────────────────────────────────────────────────

export async function promoteBranchAction(
  branchId: string
): Promise<ActionResult<PromoteBranchResult>> {
  const gate = await requireWriteRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const result = await promoteBranch(
      supabase,
      ctx.workspace.id,
      ctx.user.id,
      branchId
    );

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "draft_branch",
      object_id: branchId,
      event_type: "branch.promoted",
      metadata: {
        change_set_id: result.changeSetId,
        promoted_object_count: result.promotedObjects.length,
      },
    });

    // If the promoted branch was the active one, clear the cookie so
    // subsequent edits go back to main without a stale pointer.
    if (ctx.activeBranchId === branchId) {
      const cookieStore = await cookies();
      cookieStore.delete(ACTIVE_BRANCH_COOKIE);
    }

    revalidatePath("/app/branches");
    revalidatePath("/app");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Promote failed" };
  }
}

// ─── Discard ─────────────────────────────────────────────────────────────────

export async function discardBranchAction(
  branchId: string
): Promise<ActionResult> {
  const gate = await requireWriteRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const { data: branch } = await supabase
      .from("draft_branches")
      .select("workspace_id, status, name")
      .eq("id", branchId)
      .maybeSingle();
    if (!branch || branch.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Branch not found" };
    }
    if (branch.status !== "open") {
      return { ok: false, error: `Branch is already ${branch.status}` };
    }

    // Hard-delete every branch-scoped row (files, object_links,
    // notes, folders, boxes) created against this branch. They never
    // reached main so there is no audit history to preserve — the
    // branch_heads rows that point at them stay intact as record of
    // intent, but the data itself is dropped. This matches the
    // "discard = throw away" semantic for branch-local creation
    // across every object type with a `branch_id` column.
    await supabase.from("files").delete().eq("branch_id", branchId);
    await supabase.from("object_links").delete().eq("branch_id", branchId);
    await supabase.from("note_links").delete().eq("branch_id", branchId);
    await supabase
      .from("box_object_attachments")
      .delete()
      .eq("branch_id", branchId);
    await supabase.from("notes").delete().eq("branch_id", branchId);
    await supabase.from("folders").delete().eq("branch_id", branchId);
    await supabase.from("boxes").delete().eq("branch_id", branchId);
    await supabase.from("branch_heads").delete().eq("branch_id", branchId);

    // Drop every pending structural op. These only ever recorded
    // intent — they never mutated main — so there's nothing to
    // preserve for audit.
    const { dropAllPendingOpsForBranch } = await import(
      "@/server/services/pending_op_service"
    );
    await dropAllPendingOpsForBranch(supabase, branchId);

    // Drop every box metadata overlay for the branch. Same contract
    // as pending ops — nothing reached main so nothing to audit.
    const { dropAllBoxOverlaysForBranch } = await import(
      "@/server/services/box_branch_metadata_service"
    );
    await dropAllBoxOverlaysForBranch(supabase, branchId);

    // Drop every folder-branch override row. Same reasoning —
    // overrides only represented intent; promote never fired so
    // main is untouched and there's no audit trail to preserve.
    const { dropAllFolderOverridesForBranch } = await import(
      "@/server/services/folder_branch_service"
    );
    await dropAllFolderOverridesForBranch(supabase, branchId);

    // Drop every placement override (drag-and-drop reorder / move
    // intents against main rows). Same trust contract — no canonical
    // mutation happened, nothing to audit.
    const { dropAllPlacementOverridesForBranch } = await import(
      "@/server/services/placement_branch_service"
    );
    await dropAllPlacementOverridesForBranch(supabase, branchId);

    await discardDraftBranch(supabase, branchId);

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "draft_branch",
      object_id: branchId,
      event_type: "branch.discarded",
      metadata: { name: branch.name },
    });

    if (ctx.activeBranchId === branchId) {
      const cookieStore = await cookies();
      cookieStore.delete(ACTIVE_BRANCH_COOKIE);
    }

    revalidatePath("/app/branches");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Discard failed" };
  }
}
