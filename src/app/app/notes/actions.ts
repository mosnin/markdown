"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  updateNote,
  updateNoteOnBranch,
  getNoteForWorkspace,
} from "@/server/services/note_service";
import {
  assembleContextBundle,
  type AssembleBundleOptions,
} from "@/server/services/context_bundle_service";
import { auditBundleRead } from "@/server/services/audit_service";
import { extractAndStoreEntities } from "@/server/services/knowledge_graph_service";
import { updateNote as updateNoteInRepository } from "@/server/repositories/note_repository";
import { log } from "@/lib/logger";
import { type ContextBundle } from "@/server/domain/types/context_bundle";
import { inngest } from "@/lib/inngest/client";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Field size guards — match API route limits ───────────────────────────────
const MAX_TITLE_LENGTH = 500;
const MAX_CONTENT_LENGTH = 500_000;
const MAX_SUMMARY_LENGTH = 2000;
const MAX_TAG_LENGTH = 100;
const MAX_TAGS = 50;
const MAX_READ_HINT_LENGTH = 200;

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireContext() {
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    throw new Error("Unauthenticated");
  }
  const supabase = await createClient();
  return {
    supabase,
    userId: ctx.user.id,
    workspaceId: ctx.workspace.id,
    // Surface the active branch so the save action can route through
    // the branch write path when set. Null means "writing to main".
    activeBranchId: ctx.activeBranchId,
  };
}

// ─── Note save action ─────────────────────────────────────────────────────────

/**
 * Save note changes (title, content, metadata) and create a new version.
 * Atomic via the update_note_and_create_version RPC function.
 *
 * Input is validated here before reaching the service layer so that
 * size-limit violations return a clean error to the autosave client
 * rather than propagating as a DB constraint error.
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
  // Input validation
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return { ok: false, error: "Title is required" };
  }
  if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `Title must not exceed ${MAX_TITLE_LENGTH} characters` };
  }
  if (markdownContent.length > MAX_CONTENT_LENGTH) {
    return { ok: false, error: `Content must not exceed ${MAX_CONTENT_LENGTH} characters` };
  }
  if (summary && summary.trim().length > MAX_SUMMARY_LENGTH) {
    return { ok: false, error: `Summary must not exceed ${MAX_SUMMARY_LENGTH} characters` };
  }
  if (tags) {
    if (tags.length > MAX_TAGS) {
      return { ok: false, error: `Tags must not exceed ${MAX_TAGS} items` };
    }
    if (tags.some((t) => t.length > MAX_TAG_LENGTH)) {
      return { ok: false, error: `Each tag must not exceed ${MAX_TAG_LENGTH} characters` };
    }
  }
  if (readHint && readHint.trim().length > MAX_READ_HINT_LENGTH) {
    return { ok: false, error: `Read hint must not exceed ${MAX_READ_HINT_LENGTH} characters` };
  }

  try {
    const { supabase, userId, workspaceId, activeBranchId } = await requireContext();
    let savedBoxId: string | null = null;
    let versionNumber: number | null = null;
    if (activeBranchId) {
      // Branch save — new immutable version lands on branch_heads;
      // main's `notes.current_version_id` is untouched. Branch writes
      // don't carry summary/tags/read_hint onto the notes row today;
      // those fields stay on main until promote.
      const branchResult = await updateNoteOnBranch(
        supabase,
        userId,
        workspaceId,
        activeBranchId,
        noteId,
        {
          title: trimmedTitle,
          markdownContent,
          summary: summary?.trim() ?? null,
          tags: tags ?? [],
          readHint: readHint?.trim() ?? null,
        }
      );
      versionNumber = branchResult.version_number;
      // Branch writes don't return box_id directly — fetch from the note.
      const branchNote = await getNoteForWorkspace(supabase, noteId, workspaceId);
      savedBoxId = branchNote?.box_id ?? null;
    } else {
      const savedNote = await updateNote(supabase, userId, workspaceId, noteId, {
        title: trimmedTitle,
        markdownContent,
        summary: summary?.trim() ?? null,
        tags: tags ?? [],
        readHint: readHint?.trim() ?? null,
      });
      savedBoxId = savedNote.box_id;
    }

    // Fire-and-forget knowledge-graph extraction. Runs after the save has
    // committed so a slow/failing LLM call never delays or breaks autosave.
    // A fresh supabase client is created inside the callback because the
    // outer request-scoped client may no longer be valid once `after()` runs.
    after(async () => {
      try {
        const supa = await createClient();
        await extractAndStoreEntities(supa, {
          workspaceId,
          noteId,
          title: trimmedTitle,
          content: markdownContent,
          branchId: activeBranchId ?? null,
        });
      } catch (err) {
        log.error("save_note_kg_extraction_failed", {
          note_id: noteId,
          reason: err instanceof Error ? err.message : "unknown",
        });
      }

      // Emit note.updated so Inngest can fan out to any note_updated triggers.
      // Publish latency must not block the user's save — keep this inside
      // after() and swallow failures so a transient Inngest outage doesn't
      // surface as an autosave error.
      try {
        if (savedBoxId) {
          await inngest.send({
            name: "note.updated",
            data: {
              workspaceId,
              noteId,
              boxId: savedBoxId,
              userId,
              // versionNumber is only known on the branch path today; on the
              // main path we can't reliably detect first save here, so fall
              // back to false. Worst case: note_created triggers don't fire
              // on first save for a main-path edit — tracked as a follow-up.
              isFirstSave: versionNumber === 1,
            },
          });
        }
      } catch (err) {
        log.error("save_note_inngest_emit_failed", {
          note_id: noteId,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return { ok: true, data: {} };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    log.error("save_note_failed", { note_id: noteId, reason });
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save note" };
  }
}

// ─── Note import action ───────────────────────────────────────────────────────

export type NoteImportMode = "replace" | "append";

/**
 * Import markdown content into an existing note.
 *
 * replace — replaces the entire note body with importedMarkdown.
 * append  — appends importedMarkdown to the existing body, separated by a
 *           horizontal rule. When the note is empty, appends with no separator.
 *
 * A new version is created atomically via update_note_and_create_version with
 * change_origin = "import", so the import is distinguishable in version history.
 * Metadata (title, summary, tags, read_hint) is preserved unchanged.
 */
export async function importIntoNoteAction(
  noteId: string,
  importedMarkdown: string,
  mode: NoteImportMode
): Promise<ActionResult<undefined>> {
  if (!importedMarkdown.trim()) {
    return { ok: false, error: "Imported content is empty" };
  }
  if (importedMarkdown.length > MAX_CONTENT_LENGTH) {
    return {
      ok: false,
      error: `Imported content must not exceed ${MAX_CONTENT_LENGTH} characters`,
    };
  }

  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const note = await getNoteForWorkspace(supabase, noteId, workspaceId);
    if (!note) return { ok: false, error: "Note not found" };

    const existingBody = note.markdown_content.trim();
    const newContent =
      mode === "replace"
        ? importedMarkdown
        : existingBody
          ? `${note.markdown_content}\n\n---\n\n${importedMarkdown}`
          : importedMarkdown;

    await updateNote(supabase, userId, workspaceId, noteId, {
      title: note.title,
      markdownContent: newContent,
      summary: note.summary,
      tags: note.tags,
      readHint: note.read_hint,
      changeOrigin: "import",
    });

    revalidatePath(`/app/notes/${noteId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to import into note",
    };
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

// ─── Note retrieval metadata action ──────────────────────────────────────────

/**
 * Update retrieval_priority and/or read_hint for a note without creating
 * a new content version. Uses the repository's direct update so metadata
 * changes are cheap and don't bloat version history.
 */
export async function updateNoteRetrievalAction(
  noteId: string,
  {
    retrievalPriority,
    readHint,
  }: {
    retrievalPriority?: number;
    readHint?: string | null;
  }
): Promise<ActionResult<void>> {
  try {
    const { supabase, workspaceId } = await requireContext();
    const note = await getNoteForWorkspace(supabase, noteId, workspaceId);
    if (!note) return { ok: false, error: "Note not found" };

    const updatePayload: Record<string, unknown> = {};
    if (retrievalPriority !== undefined) {
      if (retrievalPriority < 0 || retrievalPriority > 10) {
        return { ok: false, error: "Retrieval priority must be 0–10" };
      }
      updatePayload.retrieval_priority = retrievalPriority;
    }
    if (readHint !== undefined) {
      updatePayload.read_hint = readHint ?? null;
    }
    if (Object.keys(updatePayload).length === 0) {
      return { ok: true, data: undefined };
    }

    await updateNoteInRepository(supabase, noteId, updatePayload);
    revalidatePath(`/app/notes/${noteId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update note",
    };
  }
}
