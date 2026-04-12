"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWriteRoleResult } from "@/server/auth/require_role";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import {
  listChangeSetsForWorkspace,
  listChangeSetItems,
  listStructuralEvents,
  getChangeSet,
  type ChangeSet,
  type ChangeSetItem,
  type StructuralEvent,
} from "@/server/services/change_set_service";
import {
  restoreFromChangeSet,
  planRestoreFromChangeSet,
  type RestorePlan,
  type RestoreResult,
} from "@/server/services/restore_service";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Actions backing the /app/history route.
 *
 * Reads (list / detail / plan) are available to every workspace member.
 * Writes (restore) go through `requireWriteRoleResult` so viewers are
 * rejected server-side. RLS also rejects viewers at the DB layer now —
 * see migration 20260412000005 — but keeping the service-layer gate
 * makes the error message user-facing instead of a generic permission
 * failure from Supabase.
 */

export async function listHistoryAction(
  { limit = 50 }: { limit?: number } = {}
): Promise<ActionResult<ChangeSet[]>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const rows = await listChangeSetsForWorkspace(supabase, ctx.workspace.id, {
      limit,
    });
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to list history" };
  }
}

export async function getChangeSetDetailAction(
  id: string
): Promise<ActionResult<{
  changeSet: ChangeSet;
  items: ChangeSetItem[];
  structural: StructuralEvent[];
  plan: RestorePlan;
}>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const cs = await getChangeSet(supabase, id);
    if (!cs || cs.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Change set not found" };
    }
    const [items, structural, plan] = await Promise.all([
      listChangeSetItems(supabase, id),
      listStructuralEvents(supabase, id),
      planRestoreFromChangeSet(supabase, id),
    ]);
    return { ok: true, data: { changeSet: cs, items, structural, plan } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load change set" };
  }
}

export async function restoreChangeSetAction(
  changeSetId: string
): Promise<ActionResult<RestoreResult>> {
  const gate = await requireWriteRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const cs = await getChangeSet(supabase, changeSetId);
    if (!cs || cs.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Change set not found" };
    }
    // Restoring a restore is a no-op guardrail: it would produce
    // another restore on top, cluttering history. Users who want to
    // "redo" a restore can restore the parent change set again.
    if (cs.origin === "restore") {
      return {
        ok: false,
        error: "Restores cannot themselves be restored. Open the original change set and restore it again.",
      };
    }
    const result = await restoreFromChangeSet(
      supabase,
      ctx.workspace.id,
      ctx.user.id,
      changeSetId
    );
    revalidatePath("/app/history");
    revalidatePath("/app");
    return { ok: result.ok, data: result, error: result.error } as ActionResult<RestoreResult>;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Restore failed" };
  }
}
