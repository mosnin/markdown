"use server";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getBoxById } from "@/server/repositories/box_repository";
import { signBoxToken } from "@/lib/share_token";

export async function getShareLinkAction(boxId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const box = await getBoxById(supabase, boxId);
    if (!box || box.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Not found" };
    }
    const token = signBoxToken(boxId);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.poggle.io";
    return { ok: true, url: `${baseUrl}/share/box/${token}` };
  } catch {
    return { ok: false, error: "Failed" };
  }
}
