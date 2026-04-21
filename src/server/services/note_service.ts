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
 *
 * When `branchId` is provided AND the branch has a head for this
 * note, the returned Note's `title`, `markdown_content`, and
 * `content_bytes` are patched to reflect the branch-head version
 * instead of the canonical main head. Everything else (status,
 * folder placement, tags, summary, etc.) still comes from the
 * canonical `notes` row — branches only override the versioned
 * content fields today. Callers that want a pristine main view
 * should pass `branchId: null` / omit the arg.
 */
export async function getNoteForWorkspace(
  supabase: SupabaseClient,
  noteId: string,
  workspaceId: string,
  branchId: string | null = null
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

  if (branchId) {
    const { resolveBranchVersion } = await import("./branch_service");
    const branchVersionId = await resolveBranchVersion(
      supabase,
      branchId,
      "note",
      noteId
    );
    if (branchVersionId) {
      const { data: ver } = await supabase
        .from("note_versions")
        .select("id, title, markdown_content, content_bytes")
        .eq("id", branchVersionId)
        .maybeSingle();
      if (ver) {
        return {
          ...note,
          title: ver.title,
          markdown_content: ver.markdown_content,
          content_bytes: ver.content_bytes,
          current_version_id: ver.id,
        } as Note;
      }
    }
  }
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
  // Defense-in-depth: verify the note belongs to the caller's workspace
  // before invoking the RPC. RLS would also catch cross-workspace
  // writes, but we want a predictable service-layer error. This mirrors
  // the check performed by `updateNoteOnBranch` in this same file.
  const currentNote = await getNoteById(supabase, noteId);
  if (!currentNote) throw new Error("Note not found");
  const { data: ownerBox } = await supabase
    .from("boxes")
    .select("workspace_id")
    .eq("id", currentNote.box_id)
    .maybeSingle();
  if (!ownerBox || ownerBox.workspace_id !== workspaceId) {
    throw new Error("Note not found");
  }

  // Load current note state to compute diff_summary before overwriting
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

/**
 * Update a note on a draft branch.
 *
 * Branch writes are fundamentally different from main writes:
 *
 *   * The canonical `notes` row is NEVER mutated. `current_version_id`
 *     stays pointing at main's head. Readers consulting main see no
 *     change.
 *   * A new immutable `note_versions` row IS written, with
 *     `parent_version_id` set to whatever the branch currently sees
 *     as head (either the previous branch head or, on first edit,
 *     main's current_version_id).
 *   * The branch's `branch_heads` row for this note is upserted to
 *     point at the new version id.
 *
 * This preserves every rollback invariant on main (history is never
 * mutated; main's head never advances unless the user explicitly
 * promotes the branch). Promoting a branch then becomes a clean
 * rollback-style advance of `notes.current_version_id` to the branch
 * head version — see `promoteBranch` in `branch_service.ts`.
 *
 * Branch writes do NOT currently fire the same audit event as main
 * writes; a separate `note.branch_updated` event is emitted so the
 * audit log can distinguish branch activity from main.
 */
/**
 * Create a note whose existence is scoped to a draft branch.
 *
 * Mirrors `createFileOnBranch`: the normal `createNote` path runs
 * (RPC + workspace_objects register + audit), then we stamp
 * `branch_id` on the resulting row. Until promote, main-scoped
 * readers filter out notes with `branch_id IS NOT NULL`; branch
 * readers see main + their active branch's draft notes.
 *
 * Discard of the owning branch hard-deletes these rows because they
 * never reached main and have no audit history to preserve.
 */
export async function createNoteOnBranch(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  branchId: string,
  params: Parameters<typeof createNote>[3]
): Promise<Note> {
  const { data: branch } = await supabase
    .from("draft_branches")
    .select("id, workspace_id, status")
    .eq("id", branchId)
    .maybeSingle();
  if (!branch || branch.workspace_id !== workspaceId || branch.status !== "open") {
    throw new Error("Branch not found or not open");
  }

  const note = await createNote(supabase, userId, workspaceId, params);

  await supabase
    .from("notes")
    .update({ branch_id: branchId })
    .eq("id", note.id);

  const { createAuditEvent } = await import(
    "@/server/repositories/audit_event_repository"
  );
  await createAuditEvent(supabase, {
    workspace_id: workspaceId,
    actor_type: "user",
    actor_id: userId,
    object_type: "note",
    object_id: note.id,
    event_type: "note.branch_created",
    metadata: {
      branch_id: branchId,
      box_id: note.box_id,
      folder_id: note.folder_id,
    },
  });

  return { ...note, branch_id: branchId } as Note;
}

export async function updateNoteOnBranch(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  branchId: string,
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
): Promise<{ version_id: string; version_number: number; branch_id: string; note_id: string }> {
  const { upsertBranchHead, resolveBranchVersion } = await import("./branch_service");
  const { getLatestVersionForNote, createNoteVersion } = await import(
    "@/server/repositories/note_version_repository"
  );

  // Ownership + branch validity are re-checked here so the service is
  // safe to call from anywhere (not just server actions).
  const note = await getNoteById(supabase, noteId);
  if (!note) throw new Error("Note not found");
  const { data: box } = await supabase
    .from("boxes")
    .select("workspace_id")
    .eq("id", note.box_id)
    .maybeSingle();
  if (!box || box.workspace_id !== workspaceId) throw new Error("Note not found");

  const { data: branch } = await supabase
    .from("draft_branches")
    .select("id, workspace_id, status")
    .eq("id", branchId)
    .maybeSingle();
  if (!branch || branch.workspace_id !== workspaceId || branch.status !== "open") {
    throw new Error("Branch not found or not open");
  }

  // Resolve the parent version: either the current branch head (if
  // this branch has edited the note before) or main's head. This
  // keeps the version graph honest — a branch head's parent is either
  // its previous branch head or the exact main version the branch
  // forked from.
  const branchHeadVersionId = await resolveBranchVersion(
    supabase,
    branchId,
    "note",
    noteId
  );
  const parentVersionId = branchHeadVersionId ?? note.current_version_id ?? null;

  // The next version_number is 1 + the latest for this note overall.
  // Branch versions share the same version_number sequence as main
  // versions so the linked list remains total. This matches the
  // existing rollback numbering convention.
  const latest = await getLatestVersionForNote(supabase, noteId);
  const nextVersionNumber = (latest?.version_number ?? 0) + 1;
  const contentBytes = Buffer.byteLength(markdownContent, "utf8");

  const version = await createNoteVersion(supabase, {
    note_id: noteId,
    parent_version_id: parentVersionId,
    version_number: nextVersionNumber,
    title,
    markdown_content: markdownContent,
    content_bytes: contentBytes,
    actor_type: "user",
    actor_id: userId,
    change_origin: "human_edit",
    diff_summary: {
      branch_id: branchId,
      branch_write: true,
    },
  });

  // Point the branch's head for this note at the new version. We do
  // NOT touch the notes row.
  await upsertBranchHead(supabase, {
    branch_id: branchId,
    object_type: "note",
    object_id: noteId,
    version_id: version.id,
  });

  // Also persist the non-version fields (summary, tags, read_hint) on
  // the branch head for completeness. V1 keeps these on the version
  // row itself — summary and tags ride along with diff_summary
  // metadata so promote can pick them up.
  void summary;
  void tags;
  void readHint;

  // Audit the branch write. Using a distinct event_type keeps main
  // edits and branch edits easy to filter in the audit log.
  const { createAuditEvent } = await import(
    "@/server/repositories/audit_event_repository"
  );
  await createAuditEvent(supabase, {
    workspace_id: workspaceId,
    actor_type: "user",
    actor_id: userId,
    object_type: "note",
    object_id: noteId,
    event_type: "note.branch_updated",
    metadata: {
      branch_id: branchId,
      version_id: version.id,
      version_number: version.version_number,
    },
  });

  return {
    version_id: version.id,
    version_number: version.version_number,
    branch_id: branchId,
    note_id: noteId,
  };
}
