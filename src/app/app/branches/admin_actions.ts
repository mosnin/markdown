"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdminRoleResult } from "@/server/auth/require_role";
import { purgeDiscardedOverlays } from "@/server/services/package_branch_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Admin-only server action: purge `branch_package_metadata` overlay rows
 * left behind by discarded or promoted branches.
 *
 * Access: owner and admin roles only. Members and viewers receive an
 * actionable error message.
 *
 * A `workspace.branch_overlays.purged` audit event is written on every
 * successful purge (even when deletedCount is 0) so operators can confirm
 * the action ran.
 */
export async function purgeDiscardedOverlaysAction(): Promise<
  ActionResult<{ deletedCount: number }>
> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) {
    return {
      ok: false,
      error:
        "Only workspace admins and owners can purge overlay rows. Members and viewers do not have permission to run this operation.",
    };
  }
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const { deletedCount } = await purgeDiscardedOverlays(
      supabase,
      ctx.workspace.id
    );

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "workspace",
      object_id: ctx.workspace.id,
      event_type: "workspace.branch_overlays.purged",
      metadata: { deleted_count: deletedCount },
    });

    return { ok: true, data: { deletedCount } };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Purge failed — please try again.",
    };
  }
}
