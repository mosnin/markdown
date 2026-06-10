"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getNoteById, bumpNoteShareVersion } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { signNoteToken } from "@/lib/share_token";

export async function getNoteShareLinkAction(
  noteId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const note = await getNoteById(supabase, noteId);
    if (!note) {
      return { ok: false, error: "Not found" };
    }
    // Notes don't carry workspace_id directly — they inherit it from the
    // parent box. Verify ownership by loading the box and checking its
    // workspace_id against the caller's active workspace.
    const box = await getBoxById(supabase, note.box_id);
    if (!box || box.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Not found" };
    }
    // Sign the note's current share_version into the token so a later
    // revoke can invalidate this link.
    const token = signNoteToken(noteId, note.share_version);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.poggle.io";
    return { ok: true, url: `${baseUrl}/share/note/${token}` };
  } catch {
    return { ok: false, error: "Failed" };
  }
}

/**
 * Revoke a note's share link by bumping its share_version. Every link issued
 * against the prior version 404s on the share page. Calling
 * getNoteShareLinkAction afterwards mints a fresh link.
 */
export async function revokeNoteShareLinkAction(
  noteId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireAuthenticatedUser();
    if (ctx.workspace.role === "viewer") {
      return { ok: false, error: "Viewers cannot revoke share links" };
    }
    const supabase = await createClient();
    const note = await getNoteById(supabase, noteId);
    if (!note) {
      return { ok: false, error: "Not found" };
    }
    const box = await getBoxById(supabase, note.box_id);
    if (!box || box.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Not found" };
    }
    await bumpNoteShareVersion(supabase, noteId);
    revalidatePath(`/app/notes/${noteId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Failed" };
  }
}
