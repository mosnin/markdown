import { type SupabaseClient } from "@supabase/supabase-js";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { WORKSPACE_PLANS } from "@/server/domain/types/subscription";

// ─── Plan constants ───────────────────────────────────────────────────────────

export const FREE_NOTE_LIMIT = 50;
export const FREE_BOX_LIMIT = 3;

/**
 * The three billing tiers. Mirrors the CHECK constraint on
 * workspace_subscriptions.plan. Historical callers imported `WorkspacePlan`
 * from this file, so we re-export the tuple-derived type here too.
 */
export type WorkspacePlan = (typeof WORKSPACE_PLANS)[number];

// Re-export the tuple for consumers that want to enumerate tiers.
export { WORKSPACE_PLANS } from "@/server/domain/types/subscription";

// ─── Plan helpers ─────────────────────────────────────────────────────────────

function isKnownPlan(value: unknown): value is WorkspacePlan {
  return (
    typeof value === "string" &&
    (WORKSPACE_PLANS as readonly string[]).includes(value)
  );
}

/**
 * Maps a Creem product id to a billing tier by comparing it to the configured
 * `CREEM_PRO_PRODUCT_ID` / `CREEM_BUSINESS_PRODUCT_ID` env vars.
 *
 * Used by the Creem checkout webhook so Business buyers aren't under-provisioned
 * as Pro. Defaults to `pro` when the id is missing or matches neither
 * (indeterminate) — a paying customer is never silently dropped to free, and a
 * misconfigured Business product id degrades to Pro rather than to a free
 * giveaway.
 */
export function planFromProductId(productId: string | null | undefined): WorkspacePlan {
  if (productId) {
    if (productId === process.env.CREEM_BUSINESS_PRODUCT_ID) return "business";
    if (productId === process.env.CREEM_PRO_PRODUCT_ID) return "pro";
  }
  return "pro";
}

/**
 * Returns the plan for a workspace by querying workspace_subscriptions.
 * Returns 'free' if no subscription row exists or the table is missing.
 *
 * Pro and Business tiers are only recognized when the subscription status
 * is `active` — a cancelled Pro workspace falls back to `free` privileges
 * until a new active subscription is started.
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

    if (
      isKnownPlan(data.plan) &&
      (data.plan === "pro" || data.plan === "business") &&
      data.status === "active"
    ) {
      return data.plan;
    }
    return "free";
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    // PGRST116 = table not found, 42P01 = undefined_table
    if (code === "PGRST116" || code === "42P01") return "free";
    throw err;
  }
}

/**
 * Returns true if the workspace is on a paid plan (Pro OR Business).
 *
 * Semantics widened in Phase 4: Business is a superset of Pro for every
 * feature gate that used to be Pro-only (higher note/box limits, Operator
 * access, etc.). Call `isBusinessWorkspace` when you specifically need to
 * gate on the highest tier only.
 */
export async function isProWorkspace(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<boolean> {
  const plan = await getWorkspacePlan(supabase, workspaceId);
  return plan === "pro" || plan === "business";
}

/**
 * Returns true if the workspace is on the Business plan.
 * Business-only features (e.g. the 500-run Operator quota) gate on this.
 */
export async function isBusinessWorkspace(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<boolean> {
  const plan = await getWorkspacePlan(supabase, workspaceId);
  return plan === "business";
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
