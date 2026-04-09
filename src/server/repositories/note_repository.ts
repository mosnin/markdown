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
  }: {
    folder_id?: string | null;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<Note[]> {
  let query = supabase
    .from("notes")
    .select("*")
    .eq("box_id", box_id)
    .neq("status", NOTE_STATUS.TRASHED);

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

/**
 * Fetch all non-trashed notes in a box in a single query.
 * Returns up to 1000 notes. Used for bulk export assembly.
 */
export async function listAllNotesByBox(
  supabase: SupabaseClient,
  box_id: string,
  { includeArchived = false }: { includeArchived?: boolean } = {}
): Promise<Note[]> {
  let query = supabase
    .from("notes")
    .select("*")
    .eq("box_id", box_id)
    .neq("status", NOTE_STATUS.TRASHED);

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
