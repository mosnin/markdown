import { type SupabaseClient } from "@supabase/supabase-js";
import { type Note } from "@/server/domain/types/note";
import { type NoteVersion } from "@/server/domain/types/note_version";
import { getNoteById, listNotesByBox } from "@/server/repositories/note_repository";
import { getFolderById } from "@/server/repositories/folder_repository";
import { slugify } from "@/lib/slugify";
import {
  auditNoteCreated,
  auditNoteUpdated,
} from "@/server/services/audit_service";
import { computeDiffSummary } from "@/server/services/diff_utils";

/**
 * Note service.
 *
 * Create and update operations go through Postgres RPC functions
 * (create_note_with_initial_version / update_note_and_create_version)
 * to ensure note content and its version snapshot are written atomically
 * in a single transaction. Application-layer retry is not an acceptable
 * substitute — these operations must succeed or fail as a unit.
 */

type NoteRpcRow = Note;

interface NoteRpcResult {
  note: NoteRpcRow;
  version: NoteVersion;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Check whether a path_cache is already taken in a box (excluding trashed notes). */
async function pathCacheExists(
  supabase: SupabaseClient,
  boxId: string,
  pathCache: string
): Promise<boolean> {
  const { data } = await supabase
    .from("notes")
    .select("id")
    .eq("box_id", boxId)
    .eq("path_cache", pathCache)
    .neq("status", "trashed")
    .maybeSingle();
  return !!data;
}

/** Build path_cache from folder (if any) + slug. */
async function buildPathCache(
  supabase: SupabaseClient,
  boxId: string,
  folderId: string | null | undefined,
  slug: string
): Promise<string> {
  if (!folderId) return slug;
  const folder = await getFolderById(supabase, folderId);
  if (!folder) throw new Error("Folder not found");
  return `${folder.path_cache}/${slug}`;
}

/** Generate a unique slug/path_cache for a note in a given box+folder. */
async function uniqueSlug(
  supabase: SupabaseClient,
  boxId: string,
  folderId: string | null | undefined,
  title: string
): Promise<{ slug: string; pathCache: string }> {
  const base = slugify(title);
  let slug = base;
  let suffix = 2;
  let pathCache = await buildPathCache(supabase, boxId, folderId, slug);

  while (await pathCacheExists(supabase, boxId, pathCache)) {
    slug = `${base}-${suffix++}`;
    pathCache = await buildPathCache(supabase, boxId, folderId, slug);
  }

  return { slug, pathCache };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function listNotes(
  supabase: SupabaseClient,
  boxId: string
): Promise<Note[]> {
  return listNotesByBox(supabase, boxId);
}

/**
 * Fetch a note, verifying it belongs to the given workspace via its box.
 * Returns null if not found or not owned.
 */
export async function getNoteForWorkspace(
  supabase: SupabaseClient,
  noteId: string,
  workspaceId: string
): Promise<Note | null> {
  const note = await getNoteById(supabase, noteId);
  if (!note) return null;

  // Verify box ownership
  const { data: box } = await supabase
    .from("boxes")
    .select("workspace_id")
    .eq("id", note.box_id)
    .single();

  if (!box || box.workspace_id !== workspaceId) return null;
  return note;
}

/**
 * Create a note and its initial version atomically via RPC.
 * Returns the created Note.
 */
export async function createNote(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  {
    boxId,
    folderId,
    title,
    markdownContent = "",
    summary,
    tags = [],
    readHint,
    retrievalPriority = 0,
    kind = "note",
  }: {
    boxId: string;
    folderId?: string | null;
    title: string;
    markdownContent?: string;
    summary?: string | null;
    tags?: string[];
    readHint?: string | null;
    retrievalPriority?: number;
    kind?: "note" | "guide" | "bundle";
  }
): Promise<Note> {
  const { slug, pathCache } = await uniqueSlug(supabase, boxId, folderId, title);

  const { data, error } = await supabase.rpc("create_note_with_initial_version", {
    p_box_id: boxId,
    p_folder_id: folderId ?? null,
    p_title: title,
    p_slug: slug,
    p_path_cache: pathCache,
    p_markdown_content: markdownContent,
    p_summary: summary ?? null,
    p_tags: tags,
    p_read_hint: readHint ?? null,
    p_retrieval_priority: retrievalPriority,
    p_kind: kind,
    p_actor_id: userId,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create note");
  }

  const result = data as NoteRpcResult;

  // Register the note in workspace_objects so the tree-sidebar and any other
  // cross-type view can see it and order it. Notes are not reusable, so
  // box_id is always set and is_reusable = false. The RPC above does NOT
  // touch workspace_objects — that's deliberate: the registry is maintained
  // exclusively by the service layer so every cross-type invariant lives in
  // one place.
  //
  // sort_order is a monotonically-increasing ordinal (ms since epoch). We
  // want this to fit in a bigint, not int4 — see migration
  // 20260412000002_tree_ordering_fix.sql.
  const { error: regError } = await supabase
    .from("workspace_objects")
    .insert({
      workspace_id: workspaceId,
      box_id: boxId,
      folder_id: folderId ?? null,
      object_type: "note",
      object_id: result.note.id,
      display_name: result.note.title,
      status: result.note.status ?? "active",
      is_reusable: false,
      sort_order: Date.now(),
    });
  if (regError) {
    console.error("[note_service] Failed to register workspace object for note", result.note.id, regError);
  }

  await auditNoteCreated(supabase, workspaceId, userId, result.note.id, result.note.title, boxId, kind);
  return result.note;
}

/**
 * Update a note's content and metadata, creating a new version atomically via RPC.
 * Returns the updated Note.
 */
export async function updateNote(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  noteId: string,
  {
    title,
    markdownContent,
    summary,
    tags,
    readHint,
    changeOrigin = "human_edit",
  }: {
    title: string;
    markdownContent: string;
    summary?: string | null;
    tags?: string[];
    readHint?: string | null;
    changeOrigin?: "human_edit" | "import" | "rollback";
  }
): Promise<Note> {
  // Load current note state to compute diff_summary before overwriting
  const currentNote = await getNoteById(supabase, noteId);
  const diffSummary = currentNote
    ? computeDiffSummary(
        {
          title: currentNote.title,
          markdown_content: currentNote.markdown_content,
          content_bytes: currentNote.content_bytes,
          summary: currentNote.summary,
          tags: currentNote.tags,
          status: currentNote.status,
        },
        {
          title,
          markdown_content: markdownContent,
          content_bytes: Buffer.byteLength(markdownContent, "utf8"),
          summary: summary ?? null,
          tags: tags ?? [],
          status: currentNote.status,
        }
      )
    : null;

  const { data, error } = await supabase.rpc("update_note_and_create_version", {
    p_note_id: noteId,
    p_title: title,
    p_markdown_content: markdownContent,
    p_summary: summary ?? null,
    p_tags: tags ?? [],
    p_read_hint: readHint ?? null,
    p_actor_id: userId,
    p_diff_summary: diffSummary,
    p_change_origin: changeOrigin,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to update note");
  }

  const result = data as NoteRpcResult;
  await auditNoteUpdated(supabase, workspaceId, userId, noteId, result.note.title);
  return result.note;
}
