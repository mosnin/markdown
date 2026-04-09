"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import { updateNote } from "@/server/services/note_service";
import {
  assembleContextBundle,
  type AssembleBundleOptions,
} from "@/server/services/context_bundle_service";
import { auditBundleRead } from "@/server/services/audit_service";
import { type ContextBundle } from "@/server/domain/types/context_bundle";
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

// ─── Context bundle action ────────────────────────────────────────────────────

/**
 * Assemble a context bundle for the given note.
 * Ownership verification is performed inside assembleContextBundle.
 * An audit event is written on success.
 */
export async function assembleContextBundleAction(
  noteId: string,
  options?: AssembleBundleOptions
): Promise<ActionResult<ContextBundle>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const bundle = await assembleContextBundle(
      supabase,
      workspaceId,
      noteId,
      options
    );

    // Audit: fire-and-forget
    await auditBundleRead(supabase, workspaceId, userId, noteId, {
      box_id: bundle.box.id,
      linked_count: bundle.linked_notes.length,
      guide_included: bundle.guide_note !== null,
      ancestor_summary_included: bundle.ancestor_summary_note !== null,
      truncated: bundle.truncated,
    });

    return { ok: true, data: bundle };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to assemble bundle",
    };
  }
}
