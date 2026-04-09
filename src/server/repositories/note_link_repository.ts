import { type SupabaseClient } from "@supabase/supabase-js";
import { type NoteLink } from "@/server/domain/types/note_link";
import { type RelationshipType } from "@/server/domain/constants/note_constants";

/**
 * Note link repository.
 *
 * Design notes:
 * - NoteLinks are directional: source → target.
 * - Self-links are rejected by a DB CHECK constraint.
 * - Same-box enforcement is the service layer's responsibility.
 * - No UPDATE: links are replaced by delete + re-insert.
 */

export interface CreateNoteLinkInput {
  source_note_id: string;
  target_note_id: string;
  relationship_type: RelationshipType;
}

export async function getNoteLinkById(
  supabase: SupabaseClient,
  id: string
): Promise<NoteLink | null> {
  const { data, error } = await supabase
    .from("note_links")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as NoteLink;
}

/** All links where this note is the source. */
export async function listLinksFromNote(
  supabase: SupabaseClient,
  source_note_id: string
): Promise<NoteLink[]> {
  const { data, error } = await supabase
    .from("note_links")
    .select("*")
    .eq("source_note_id", source_note_id)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return data as NoteLink[];
}

/** All links where this note is the target. */
export async function listLinksToNote(
  supabase: SupabaseClient,
  target_note_id: string
): Promise<NoteLink[]> {
  const { data, error } = await supabase
    .from("note_links")
    .select("*")
    .eq("target_note_id", target_note_id)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return data as NoteLink[];
}

export async function createNoteLink(
  supabase: SupabaseClient,
  input: CreateNoteLinkInput
): Promise<NoteLink> {
  const { data, error } = await supabase
    .from("note_links")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create note link");
  return data as NoteLink;
}

export async function deleteNoteLink(
  supabase: SupabaseClient,
  id: string
): Promise<boolean> {
  const { error } = await supabase
    .from("note_links")
    .delete()
    .eq("id", id);

  return !error;
}

/**
 * Fetch all links where either source_note_id or target_note_id is in noteIds.
 * Used for export to collect only links whose both endpoints are in the export set.
 */
export async function listLinksForNoteSet(
  supabase: SupabaseClient,
  noteIds: string[]
): Promise<NoteLink[]> {
  if (noteIds.length === 0) return [];

  const { data, error } = await supabase
    .from("note_links")
    .select("*")
    .or(`source_note_id.in.(${noteIds.join(",")}),target_note_id.in.(${noteIds.join(",")})`);

  if (error || !data) return [];
  return data as NoteLink[];
}

/** Remove all links between two specific notes (either direction). */
export async function deleteNoteLinksBetween(
  supabase: SupabaseClient,
  note_a_id: string,
  note_b_id: string
): Promise<void> {
  await supabase
    .from("note_links")
    .delete()
    .eq("source_note_id", note_a_id)
    .eq("target_note_id", note_b_id);

  await supabase
    .from("note_links")
    .delete()
    .eq("source_note_id", note_b_id)
    .eq("target_note_id", note_a_id);
}
