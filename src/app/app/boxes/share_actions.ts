"use server";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getBoxById, bumpBoxShareVersion } from "@/server/repositories/box_repository";
import { signBoxToken } from "@/lib/share_token";

export async function getShareLinkAction(boxId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const box = await getBoxById(supabase, boxId);
    if (!box || box.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Not found" };
    }
    // Sign the box's current share_version into the token so a later
    // revoke (or privacy toggle) can invalidate this link.
    const token = signBoxToken(boxId, box.share_version);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.poggle.io";
    return { ok: true, url: `${baseUrl}/share/box/${token}` };
  } catch {
    return { ok: false, error: "Failed" };
  }
}

/**
 * Revoke a box's share link by bumping its share_version. Every link issued
 * against the prior version 404s on the share page. Calling getShareLinkAction
 * afterwards mints a fresh link against the new version.
 */
export async function revokeBoxShareLinkAction(
  boxId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireAuthenticatedUser();
    if (ctx.workspace.role === "viewer") {
      return { ok: false, error: "Viewers cannot revoke share links" };
    }
    const supabase = await createClient();
    const box = await getBoxById(supabase, boxId);
    if (!box || box.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Not found" };
    }
    await bumpBoxShareVersion(supabase, boxId);
    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Failed" };
  }
}
