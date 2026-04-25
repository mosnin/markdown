import { type SupabaseClient } from "@supabase/supabase-js";
import { type NoteVersion } from "@/server/domain/types/note_version";
import { type ActorType, type ChangeOrigin } from "@/server/domain/constants/audit_constants";
import { RepositoryError } from "@/server/domain/errors";

/**
 * Note version repository.
 *
 * Design notes:
 * - NoteVersions are immutable — INSERT only, no UPDATE or DELETE.
 * - version_number is assigned by the caller (service responsibility).
 * - After creating a version, callers should call updateNote() to set
 *   current_version_id on the parent note.
 */

export interface CreateNoteVersionInput {
  note_id: string;
  parent_version_id?: string | null;
  version_number: number;
  title: string;
  markdown_content: string;
  content_bytes: number;
  actor_type: ActorType;
  actor_id: string;
  change_origin: ChangeOrigin;
  diff_summary?: Record<string, unknown> | null;
  diff_patch?: string | null;
}

export async function getNoteVersionById(
  supabase: SupabaseClient,
  id: string
): Promise<NoteVersion | null> {
  const { data, error } = await supabase
    .from("note_versions")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as NoteVersion;
}

/**
 * Fetch a version and verify it belongs to the given note.
 * Returns null if not found or if the note_id does not match.
 * This is the safe lookup for history and rollback operations.
 */
export async function getVersionByNoteAndId(
  supabase: SupabaseClient,
  noteId: string,
  versionId: string
): Promise<NoteVersion | null> {
  const { data, error } = await supabase
    .from("note_versions")
    .select("*")
    .eq("id", versionId)
    .eq("note_id", noteId)
    .single();

  if (error || !data) return null;
  return data as NoteVersion;
}

export async function listVersionsByNote(
  supabase: SupabaseClient,
  note_id: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<NoteVersion[]> {
  const { data, error } = await supabase
    .from("note_versions")
    .select("*")
    .eq("note_id", note_id)
    .order("version_number", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error || !data) return [];
  return data as NoteVersion[];
}

export async function getLatestVersionForNote(
  supabase: SupabaseClient,
  note_id: string
): Promise<NoteVersion | null> {
  const { data, error } = await supabase
    .from("note_versions")
    .select("*")
    .eq("note_id", note_id)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as NoteVersion;
}

export async function createNoteVersion(
  supabase: SupabaseClient,
  input: CreateNoteVersionInput
): Promise<NoteVersion> {
  const { data, error } = await supabase
    .from("note_versions")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new RepositoryError("createNoteVersion", error);
  return data as NoteVersion;
}
