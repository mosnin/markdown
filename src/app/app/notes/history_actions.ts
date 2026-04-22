"use server";

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getNoteForWorkspace } from "@/server/services/note_service";
import {
  listVersionsByNote,
  getVersionByNoteAndId,
} from "@/server/repositories/note_version_repository";
import { saveNoteAction } from "@/app/app/notes/actions";

/**
 * Note version history server actions.
 *
 * These are read-only surfaces over the `note_versions` table plus a
 * restore action that funnels through `saveNoteAction` so the restore
 * lands as a NEW immutable version on top of history rather than
 * mutating or overwriting any existing row.
 *
 * Ownership check: each action re-loads the parent note and verifies
 * its `workspace_id` matches the caller's active workspace. This
 * mirrors the service-layer guard pattern used elsewhere in the app.
 */

export interface VersionListItem {
  id: string;
  version_number: number;
  created_at: string;
  title: string;
  content_preview: string;
}

export interface VersionDetail {
  id: string;
  version_number: number;
  title: string;
  markdown_content: string;
  created_at: string;
}

export type HistoryActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function listNoteVersionsAction(
  noteId: string
): Promise<HistoryActionResult<VersionListItem[]>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const note = await getNoteForWorkspace(supabase, noteId, ctx.workspace.id);
    if (!note) {
      return { ok: false, error: "Not found" };
    }

    const versions = await listVersionsByNote(supabase, noteId);
    const mapped: VersionListItem[] = versions.map((v) => ({
      id: v.id,
      version_number: v.version_number,
      created_at: v.created_at,
      title: v.title,
      content_preview: (v.markdown_content ?? "").slice(0, 200),
    }));

    return { ok: true, data: mapped };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function getNoteVersionDetailAction(
  noteId: string,
  versionId: string
): Promise<HistoryActionResult<VersionDetail>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const note = await getNoteForWorkspace(supabase, noteId, ctx.workspace.id);
    if (!note) {
      return { ok: false, error: "Not found" };
    }

    const version = await getVersionByNoteAndId(supabase, noteId, versionId);
    if (!version) return { ok: false, error: "Version not found" };

    return {
      ok: true,
      data: {
        id: version.id,
        version_number: version.version_number,
        title: version.title,
        markdown_content: version.markdown_content ?? "",
        created_at: version.created_at,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/**
 * Restore the note to the content of a previous version.
 *
 * Rather than mutating history, we delegate to `saveNoteAction`, which
 * runs through the same update_note_and_create_version RPC that
 * autosave uses. The effect is that a restore appears in history as a
 * new version whose content equals the restored version — so the
 * audit trail is preserved and restore is itself reversible.
 *
 * Note metadata (summary / tags / read_hint) is carried over from the
 * current note row — version rows don't store those fields, so there
 * is nothing in the historical record to re-apply here.
 */
export async function restoreNoteVersionAction(
  noteId: string,
  versionId: string
): Promise<HistoryActionResult<undefined>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const note = await getNoteForWorkspace(supabase, noteId, ctx.workspace.id);
    if (!note) {
      return { ok: false, error: "Not found" };
    }

    const version = await getVersionByNoteAndId(supabase, noteId, versionId);
    if (!version) return { ok: false, error: "Version not found" };

    const saveResult = await saveNoteAction(noteId, {
      title: version.title,
      markdownContent: version.markdown_content ?? "",
      summary: note.summary,
      tags: note.tags,
      readHint: note.read_hint,
    });

    if (!saveResult.ok) return { ok: false, error: saveResult.error };
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
