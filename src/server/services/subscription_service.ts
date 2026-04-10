import { type SupabaseClient } from "@supabase/supabase-js";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";

// ─── Plan constants ───────────────────────────────────────────────────────────

export const FREE_NOTE_LIMIT = 50;
export const FREE_BOX_LIMIT = 3;

export type WorkspacePlan = "free" | "pro";

// ─── Plan helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the plan for a workspace by querying workspace_subscriptions.
 * Returns 'free' if no subscription row exists or the table is missing.
 */
export async function getWorkspacePlan(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<WorkspacePlan> {
  try {
    const { data, error } = await supabase
      .from("workspace_subscriptions")
      .select("plan, status")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error || !data) return "free";

    // Only treat active pro subscriptions as pro
    if (data.plan === "pro") return "pro";
    return "free";
  } catch {
    // Table may not exist yet — degrade gracefully
    return "free";
  }
}

/**
 * Returns true if the workspace is on the Pro plan.
 */
export async function isProWorkspace(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<boolean> {
  const plan = await getWorkspacePlan(supabase, workspaceId);
  return plan === "pro";
}

/**
 * Returns the subscription status string from the database row, if any.
 * Used to detect 'past_due' situations for the billing UI.
 * Returns null if the workspace is on the free plan or no row exists.
 */
export async function getSubscriptionStatus(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("workspace_subscriptions")
      .select("status")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error || !data) return null;
    return data.status as string;
  } catch {
    return null;
  }
}

// ─── Limit checks ─────────────────────────────────────────────────────────────

/**
 * Checks whether the workspace is allowed to create another note.
 * Pro workspaces are always allowed. Free workspaces are capped at FREE_NOTE_LIMIT.
 *
 * Note count is the sum of non-trashed, non-archived notes across all boxes.
 */
export async function checkNoteLimit(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<{ allowed: boolean; current: number; max: number }> {
  const pro = await isProWorkspace(supabase, workspaceId);
  if (pro) {
    return { allowed: true, current: 0, max: Infinity };
  }

  // Count non-trashed, non-archived notes across the whole workspace via a
  // join on boxes so we stay within workspace scope.
  const { count, error } = await supabase
    .from("notes")
    .select("id", { count: "exact", head: true })
    .in(
      "box_id",
      // subquery: box ids belonging to this workspace
      (
        await supabase
          .from("boxes")
          .select("id")
          .eq("workspace_id", workspaceId)
          .neq("status", "trashed")
      ).data?.map((b: { id: string }) => b.id) ?? []
    )
    .neq("status", "trashed")
    .neq("status", "archived");

  if (error) {
    // Fail open — do not block creation if count query errors
    return { allowed: true, current: 0, max: FREE_NOTE_LIMIT };
  }

  const current = count ?? 0;
  return {
    allowed: current < FREE_NOTE_LIMIT,
    current,
    max: FREE_NOTE_LIMIT,
  };
}

/**
 * Checks whether the workspace is allowed to create another box.
 * Pro workspaces are always allowed. Free workspaces are capped at FREE_BOX_LIMIT.
 */
export async function checkBoxLimit(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<{ allowed: boolean; current: number; max: number }> {
  const pro = await isProWorkspace(supabase, workspaceId);
  if (pro) {
    return { allowed: true, current: 0, max: Infinity };
  }

  const boxes = await listBoxesByWorkspace(supabase, workspaceId);
  const current = boxes.length;
  return {
    allowed: current < FREE_BOX_LIMIT,
    current,
    max: FREE_BOX_LIMIT,
  };
}
