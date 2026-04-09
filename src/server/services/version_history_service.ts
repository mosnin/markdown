import { type SupabaseClient } from "@supabase/supabase-js";
import { type NoteVersion } from "@/server/domain/types/note_version";
import { type Note } from "@/server/domain/types/note";
import { getNoteById } from "@/server/repositories/note_repository";
import {
  listVersionsByNote,
  getVersionByNoteAndId,
} from "@/server/repositories/note_version_repository";
import { computeRollbackDiff } from "@/server/services/diff_utils";
import { auditNoteRollback } from "@/server/services/audit_service";

/**
 * Version history service.
 *
 * All public functions enforce ownership through the note's box and workspace.
 * The two-hop check (note → box → workspace_id) is the canonical ownership
 * pattern in this codebase and must not be bypassed.
 *
 * Rollback creates a fresh new version from the selected historical snapshot.
 * Historical version rows are never mutated or deleted.
 */

export interface VersionListItem extends NoteVersion {
  is_current: boolean;
}

export interface VersionHistoryResult {
  note_id: string;
  current_version_id: string | null;
  versions: VersionListItem[];
  total_fetched: number;
  limit: number;
  offset: number;
}

export interface VersionDetailResult {
  version: NoteVersion;
  is_current: boolean;
  note_id: string;
}

export interface RollbackResult {
  new_version_id: string;
  version_number: number;
  restored_from_version_id: string;
  note: Note;
}

// ─── Ownership check ──────────────────────────────────────────────────────────

async function resolveNoteWithOwnership(
  supabase: SupabaseClient,
  noteId: string,
  workspaceId: string
): Promise<Note> {
  const note = await getNoteById(supabase, noteId);
  if (!note) throw new Error("Note not found");

  const { data: box } = await supabase
    .from("boxes")
    .select("workspace_id")
    .eq("id", note.box_id)
    .single();

  if (!box || box.workspace_id !== workspaceId) {
    throw new Error("Note not found");
  }

  return note;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * List versions for a note, newest first.
 * Enforces ownership: note must belong to the given workspace.
 */
export async function listVersionsForNote(
  supabase: SupabaseClient,
  workspaceId: string,
  noteId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<VersionHistoryResult> {
  const note = await resolveNoteWithOwnership(supabase, noteId, workspaceId);

  const versions = await listVersionsByNote(supabase, noteId, { limit, offset });

  return {
    note_id: noteId,
    current_version_id: note.current_version_id ?? null,
    versions: versions.map((v) => ({
      ...v,
      is_current: v.id === note.current_version_id,
    })),
    total_fetched: versions.length,
    limit,
    offset,
  };
}

/**
 * Fetch a single version, verifying it belongs to the given note and workspace.
 */
export async function getVersionForNote(
  supabase: SupabaseClient,
  workspaceId: string,
  noteId: string,
  versionId: string
): Promise<VersionDetailResult> {
  const note = await resolveNoteWithOwnership(supabase, noteId, workspaceId);

  const version = await getVersionByNoteAndId(supabase, noteId, versionId);
  if (!version) throw new Error("Version not found");

  return {
    version,
    is_current: version.id === note.current_version_id,
    note_id: noteId,
  };
}

/**
 * Roll back a note to a prior version.
 *
 * Creates a new version whose content is a copy of the selected historical
 * snapshot, then advances the note's current_version_id to the new version.
 * The target historical version is never mutated.
 *
 * Enforces:
 *   - Note must belong to the given workspace
 *   - Target version must belong to this note (verified in the SQL function)
 *   - Actor must be a human user (rollback is not exposed to external tools)
 */
export async function rollbackNoteToVersion(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  noteId: string,
  targetVersionId: string
): Promise<RollbackResult> {
  // 1. Verify ownership and load current note state
  const note = await resolveNoteWithOwnership(supabase, noteId, workspaceId);

  // 2. Load and verify target version (ownership check before calling RPC)
  const targetVersion = await getVersionByNoteAndId(supabase, noteId, targetVersionId);
  if (!targetVersion) throw new Error("Version not found");

  // 3. Compute diff_summary: current note → target snapshot
  const diffSummary = computeRollbackDiff(
    {
      title: note.title,
      markdown_content: note.markdown_content,
      content_bytes: note.content_bytes,
      summary: note.summary,
      tags: note.tags,
      status: note.status,
    },
    {
      title: targetVersion.title,
      markdown_content: targetVersion.markdown_content,
      content_bytes: targetVersion.content_bytes,
    }
  );

  // 4. Call atomic SQL function
  const { data, error } = await supabase.rpc("rollback_note_to_version", {
    p_note_id: noteId,
    p_target_version_id: targetVersionId,
    p_actor_id: userId,
    p_diff_summary: diffSummary,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Rollback failed");
  }

  const rpcResult = data as { new_version_id: string; version_number: number };

  // 5. Reload updated note
  const updatedNote = await getNoteById(supabase, noteId);
  if (!updatedNote) throw new Error("Note not found after rollback");

  // 6. Fire audit event (fire-and-forget)
  await auditNoteRollback(supabase, workspaceId, userId, noteId, {
    prior_version_id: note.current_version_id ?? null,
    restored_from_version_id: targetVersionId,
    new_version_id: rpcResult.new_version_id,
    box_id: note.box_id,
  });

  return {
    new_version_id: rpcResult.new_version_id,
    version_number: rpcResult.version_number,
    restored_from_version_id: targetVersionId,
    note: updatedNote,
  };
}
