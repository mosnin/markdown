"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import { updateNote } from "@/server/services/note_service";
import type { ActionResult } from "@/app/app/boxes/actions";

export type { ActionResult };

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireContext() {
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    throw new Error("Unauthenticated");
  }
  const supabase = await createClient();
  return { supabase, userId: ctx.user.id, workspaceId: ctx.workspace.id };
}

// ─── Note save action ─────────────────────────────────────────────────────────

/**
 * Save note changes (title, content, metadata) and create a new version.
 * Atomic via the update_note_and_create_version RPC function.
 */
export async function saveNoteAction(
  noteId: string,
  {
    title,
    markdownContent,
    summary,
    tags,
    readHint,
  }: {
    title: string;
    markdownContent: string;
    summary?: string | null;
    tags?: string[];
    readHint?: string | null;
  }
): Promise<ActionResult<{ versionNumber?: number }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    await updateNote(supabase, userId, workspaceId, noteId, {
      title: title.trim(),
      markdownContent,
      summary: summary?.trim() ?? null,
      tags: tags ?? [],
      readHint: readHint?.trim() ?? null,
    });
    revalidatePath(`/app/notes/${noteId}`);
    return { ok: true, data: {} };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save note" };
  }
}
