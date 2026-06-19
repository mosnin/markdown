import { type SupabaseClient } from "@supabase/supabase-js";
import { type NoteLink } from "@/server/domain/types/note_link";
import { type RelationshipType } from "@/server/domain/constants/note_constants";
import { RepositoryError } from "@/server/domain/errors";

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
  relationship_note?: string | null;
  /**
   * Optional branch ownership. `null` (or omitted) writes a main
   * row; a uuid lands the link on a draft branch. See
   * docs/branch_local_structural_creation_v1.md (v1.10).
   */
  branch_id?: string | null;
}

/**
 * Shared branch-filter shape: reads accept an optional `branchId`.
 *   - null / undefined → main-only view (branch_id IS NULL)
 *   - uuid → main + rows whose branch_id matches
 */
type BranchFilter = { branchId?: string | null };

function applyBranchFilter<Q extends {
  or: (expr: string) => Q;
  is: (col: string, v: unknown) => Q;
}>(query: Q, branchId: string | null | undefined): Q {
  if (branchId) {
    return query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  }
  return query.is("branch_id", null);
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
  source_note_id: string,
  { branchId = null }: BranchFilter = {}
): Promise<NoteLink[]> {
  let query = supabase
    .from("note_links")
    .select("*")
    .eq("source_note_id", source_note_id);
  query = applyBranchFilter(query, branchId);
  const { data, error } = await query.order("created_at", { ascending: true });

  if (error || !data) return [];
  return data as NoteLink[];
}

/**
 * All links whose source is any of the given notes — batched into ONE query.
 *
 * Semantically identical to calling listLinksFromNote() per note and
 * concatenating, but collapses an N+1 (one round-trip per note) into a single
 * `source_note_id IN (...)` query. Branch filter matches listLinksFromNote.
 */
export async function listLinksFromNotes(
  supabase: SupabaseClient,
  sourceNoteIds: string[],
  { branchId = null }: BranchFilter = {}
): Promise<NoteLink[]> {
  if (sourceNoteIds.length === 0) return [];
  let query = supabase
    .from("note_links")
    .select("*")
    .in("source_note_id", sourceNoteIds);
  query = applyBranchFilter(query, branchId);
  const { data, error } = await query.order("created_at", { ascending: true });

  if (error || !data) return [];
  return data as NoteLink[];
}

/** All links where this note is the target. */
export async function listLinksToNote(
  supabase: SupabaseClient,
  target_note_id: string,
  { branchId = null }: BranchFilter = {}
): Promise<NoteLink[]> {
  let query = supabase
    .from("note_links")
    .select("*")
    .eq("target_note_id", target_note_id);
  query = applyBranchFilter(query, branchId);
  const { data, error } = await query.order("created_at", { ascending: true });

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

  if (error || !data) throw new RepositoryError("createNoteLink", error);
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
