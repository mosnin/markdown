"use server";

/**
 * Server action for the agent triggers "Run now" button.
 *
 * Publishes an `agent_trigger.manual` event onto Inngest. Ownership is
 * validated via the user's cookie-scoped Supabase client (RLS enforces
 * workspace membership) before the event is sent. The actual execution
 * happens in `executeManualTrigger` — this action returns as soon as
 * Inngest accepts the event.
 */
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function runTriggerNowAction(
  triggerId: string
): Promise<ActionResult<{ eventId: string }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    // Ownership check — the trigger must live in the caller's workspace.
    // RLS should already enforce this, but we double-check so the error
    // message is friendly instead of a generic "not found".
    const { data: trigger, error } = await supabase
      .from("agent_triggers")
      .select("id, workspace_id, is_enabled")
      .eq("id", triggerId)
      .maybeSingle();
    if (error || !trigger || trigger.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Trigger not found" };
    }
    if (!trigger.is_enabled) {
      return { ok: false, error: "Trigger is disabled" };
    }

    const result = await inngest.send({
      name: "agent_trigger.manual",
      data: {
        triggerId,
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
      },
    });

    return { ok: true, data: { eventId: result.ids[0] ?? "" } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed",
    };
  }
}
