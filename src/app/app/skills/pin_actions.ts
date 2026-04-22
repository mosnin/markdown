"use server";

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";

export type PinActionResult = { ok: true } | { ok: false; error: string };

export async function togglePinnedSkillAction(
  attachmentId: string,
  isPinned: boolean
): Promise<PinActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const { error } = await supabase
      .from("box_object_attachments")
      .update({ is_default: isPinned })
      .eq("id", attachmentId)
      .eq("workspace_id", ctx.workspace.id);

    if (error) throw error;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
