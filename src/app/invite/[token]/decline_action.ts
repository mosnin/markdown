"use server";

import { createClient } from "@/lib/supabase/server";
import { declineInvitation } from "@/server/services/workspace_invitation_service";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Decline an invitation by token. Does not require authentication —
 * anyone with the token can decline (the token is a secret).
 */
export async function declineInvitationClientAction(
  token: string
): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    await declineInvitation(supabase, token);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to decline invitation",
    };
  }
}
