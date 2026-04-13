import { type SupabaseClient } from "@supabase/supabase-js";
import { type Note } from "@/server/domain/types/note";
import {
  type CreateNoteInput,
  type UpdateNoteInput,
} from "@/server/domain/schemas/note_schemas";
import { NOTE_STATUS } from "@/server/domain/constants/content_status";

/**
 * Note repository.
 *
 * Design notes:
 * - path_cache is written by the caller; this repository does not compute it.
 * - content_bytes should be set to the byte length of markdown_content
 *   before calling createNote or updateNote (service responsibility).
 * - current_version_id is updated via updateNote after a version is created.
 * - No is_guide_note column exists — guide assignment is in boxes.guide_note_id.
 */

export async function getNoteById(
  supabase: SupabaseClient,
  id: string
): Promise<Note | null> {
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as Note;
}

export async function getNoteByPath(
  supabase: SupabaseClient,
  box_id: string,
  path_cache: string
): Promise<Note | null> {
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("box_id", box_id)
    .eq("path_cache", path_cache)
    .neq("status", NOTE_STATUS.TRASHED)
    .single();

  if (error || !data) return null;
  return data as Note;
}

export async function listNotesByBox(
  supabase: SupabaseClient,
  box_id: string,
  {
    folder_id,
    includeArchived = false,
    limit = 100,
    offset = 0,
    branchId = null,
  }: {
    folder_id?: string | null;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
    /**
     * Branch context for the read:
     *   - null → main-only view (notes with branch_id IS NULL)
     *   - uuid → main + rows whose branch_id matches the given branch
     * Mirrors the same contract as listFilesByBox.
     */
    branchId?: string | null;
  } = {}
): Promise<Note[]> {
  let query = supabase
    .from("notes")
    .select("*")
    .eq("box_id", box_id)
    .neq("status", NOTE_STATUS.TRASHED);

  // Branch filter: either show only main rows (branch_id is null) or
  // show main + rows belonging to the specified branch.
  if (branchId) {
    query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  } else {
    query = query.is("branch_id", null);
  }

  if (!includeArchived) {
    query = query.neq("status", NOTE_STATUS.ARCHIVED);
  }

  // null means root level; undefined means all folders
  if (folder_id !== undefined) {
    if (folder_id === null) {
      query = query.is("folder_id", null);
    } else {
      query = query.eq("folder_id", folder_id);
    }
  }

  const { data, error } = await query
    .order("retrieval_priority", { ascending: false })
    .order("title", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error || !data) return [];

  // Pending-op overlay: if the active branch has a `trash` pending
  // op for any of these notes, hide them. This is the read-side of
  // the soft-delete-on-branch contract — `docs/branch_pending_ops_v1.md`.
  if (branchId && (data as Note[]).length > 0) {
    const { getHiddenByPendingOps } = await import(
      "@/server/services/pending_op_service"
    );
    const hidden = await getHiddenByPendingOps(supabase, branchId);
    return (data as Note[]).filter((n) => !hidden.has(`note:${n.id}`));
  }

  return data as Note[];
}

export async function createNote(
  supabase: SupabaseClient,
  input: CreateNoteInput & { content_bytes: number }
): Promise<Note> {
  const { data, error } = await supabase
    .from("notes")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create note");
  return data as Note;
}

export async function updateNote(
  supabase: SupabaseClient,
  id: string,
  input: UpdateNoteInput & { content_bytes?: number; path_cache?: string }
): Promise<Note | null> {
  const { data, error } = await supabase
    .from("notes")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) return null;
  return data as Note;
}

/** List trashed notes for a box (for the trash recovery surface). */
export async function listTrashedNotesByBox(
  supabase: SupabaseClient,
  box_id: string
): Promise<Note[]> {
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("box_id", box_id)
    .eq("status", NOTE_STATUS.TRASHED)
    .order("updated_at", { ascending: false });

  if (error || !data) return [];
  return data as Note[];
}

/** List archived notes for a box (for the archive browsing surface). */
export async function listArchivedNotesByBox(
  supabase: SupabaseClient,
  box_id: string
): Promise<Note[]> {
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("box_id", box_id)
    .eq("status", NOTE_STATUS.ARCHIVED)
    .order("updated_at", { ascending: false });

  if (error || !data) return [];
  return data as Note[];
}

/**
 * Fetch all non-trashed notes in a box in a single query.
 * Returns up to 1000 notes. Used for bulk export assembly.
 */
export async function listAllNotesByBox(
  supabase: SupabaseClient,
  box_id: string,
  {
    includeArchived = false,
    branchId = null,
  }: {
    includeArchived?: boolean;
    /**
     * Branch context for the read:
     *   - null → main-only view (notes with branch_id IS NULL)
     *   - uuid → main + rows whose branch_id matches the given branch
     * Used by export assembly; no pending-op hide overlay is applied
     * here — exports need the raw canonical set.
     */
    branchId?: string | null;
  } = {}
): Promise<Note[]> {
  let query = supabase
    .from("notes")
    .select("*")
    .eq("box_id", box_id)
    .neq("status", NOTE_STATUS.TRASHED);

  if (branchId) {
    query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  } else {
    query = query.is("branch_id", null);
  }

  if (!includeArchived) {
    query = query.neq("status", NOTE_STATUS.ARCHIVED);
  }

  const { data, error } = await query
    .order("path_cache", { ascending: true })
    .limit(1000);

  if (error || !data) return [];
  return data as Note[];
}

/** Bulk-fetch notes by id. Used for bundle assembly and export prep. */
export async function getNotesByIds(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Note[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .in("id", ids);

  if (error || !data) return [];
  return data as Note[];
}
