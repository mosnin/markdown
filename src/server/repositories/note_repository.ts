import { type SupabaseClient } from "@supabase/supabase-js";
import { type Note } from "@/server/domain/types/note";
import {
  type CreateNoteInput,
  type UpdateNoteInput,
} from "@/server/domain/schemas/note_schemas";
import { NOTE_STATUS } from "@/server/domain/constants/content_status";
import { logger } from "@/lib/logger";

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

// Heavy: used only when the full note body is needed (editor, export)
const NOTE_FULL_COLS = "id, box_id, folder_id, current_version_id, title, slug, path_cache, markdown_content, content_bytes, summary, tags, read_hint, retrieval_priority, kind, status, origin_type, is_generated, generated_by_connection_id, branch_id, created_at, updated_at";

// Light: used for lists, sidebars, search results — no markdown body
const NOTE_LIST_COLS = "id, box_id, folder_id, current_version_id, title, slug, path_cache, content_bytes, tags, read_hint, retrieval_priority, kind, status, origin_type, is_generated, generated_by_connection_id, branch_id, created_at, updated_at";

export async function getNoteById(
  supabase: SupabaseClient,
  id: string
): Promise<Note | null> {
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_FULL_COLS)
    .eq("id", id)
    .single();

  if (error || !data) {
    if (error) logger.error({ err: error, id }, "getNoteById failed");
    return null;
  }
  return data as Note;
}

export async function getNoteByPath(
  supabase: SupabaseClient,
  box_id: string,
  path_cache: string
): Promise<Note | null> {
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_FULL_COLS)
    .eq("box_id", box_id)
    .eq("path_cache", path_cache)
    .neq("status", NOTE_STATUS.TRASHED)
    .single();

  if (error || !data) {
    if (error) logger.error({ err: error, box_id, path_cache }, "getNoteByPath failed");
    return null;
  }
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
    .select(NOTE_LIST_COLS)
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

  if (error || !data) {
    if (error) logger.error({ err: error, box_id }, "listNotesByBox failed");
    return [];
  }

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

  if (error || !data) throw new Error(error?.message ?? "Failed to update note");
  return data as Note;
}

/**
 * List trashed notes for a box (for the trash recovery surface).
 *
 * Branch-aware overlay (when `branchId` is supplied):
 *   - Canonical trashed notes (status=trashed, branch_id IS NULL) are
 *     included by default.
 *   - Main-active notes that carry a pending `trash` op for this branch
 *     are also surfaced — the user's branch view treats them as trashed
 *     even though canonical status is still `active`.
 *   - Branch-local trashed rows (branch_id = <this branch>) are included.
 * Pending ops on other branches never leak into this branch's view.
 */
export async function listTrashedNotesByBox(
  supabase: SupabaseClient,
  box_id: string,
  { branchId = null }: { branchId?: string | null } = {}
): Promise<Note[]> {
  return listLifecycleNotesByBox(supabase, box_id, {
    canonicalStatus: NOTE_STATUS.TRASHED,
    pendingOpType: "trash",
    branchId,
  });
}

/**
 * List archived notes for a box (for the archive browsing surface).
 *
 * Branch-aware overlay mirrors `listTrashedNotesByBox`: include
 * canonically archived notes unless the branch has a pending
 * `unarchive` op for them; also include main-active notes that have a
 * pending `archive` op on this branch.
 */
export async function listArchivedNotesByBox(
  supabase: SupabaseClient,
  box_id: string,
  { branchId = null }: { branchId?: string | null } = {}
): Promise<Note[]> {
  return listLifecycleNotesByBox(supabase, box_id, {
    canonicalStatus: NOTE_STATUS.ARCHIVED,
    pendingOpType: "archive",
    branchId,
  });
}

/**
 * Shared loader for archived/trashed notes with branch overlay.
 *
 * Semantics (when `branchId` is set):
 *   - Start with the canonical set (status = canonicalStatus,
 *     branch_id IS NULL) and branch-local rows (branch_id = branchId,
 *     status = canonicalStatus).
 *   - For canonical rows, drop those whose branch has a pending op of
 *     the reverse kind:
 *       * trash canonical + `unarchive` on branch → still shown
 *         (archive/unarchive doesn't affect trash visibility).
 *       * archive canonical + `unarchive` on branch → hidden (branch
 *         restored it).
 *     In v1 we only treat `unarchive` as reversing `archive`.
 *   - Fold in main-active rows that have a pending op for this branch
 *     matching `pendingOpType` (archive → archived tab, trash → trash
 *     tab). These rows keep their canonical status=active but render
 *     as archived/trashed under the branch's view.
 */
async function listLifecycleNotesByBox(
  supabase: SupabaseClient,
  box_id: string,
  {
    canonicalStatus,
    pendingOpType,
    branchId,
  }: {
    canonicalStatus: typeof NOTE_STATUS.ARCHIVED | typeof NOTE_STATUS.TRASHED;
    pendingOpType: "archive" | "trash";
    branchId: string | null;
  }
): Promise<Note[]> {
  // Canonical + branch-local rows with this status.
  let canonicalQuery = supabase
    .from("notes")
    .select(NOTE_LIST_COLS)
    .eq("box_id", box_id)
    .eq("status", canonicalStatus);

  if (branchId) {
    canonicalQuery = canonicalQuery.or(
      `branch_id.is.null,branch_id.eq.${branchId}`
    );
  } else {
    canonicalQuery = canonicalQuery.is("branch_id", null);
  }

  const { data: canonicalData, error } = await canonicalQuery.order(
    "updated_at",
    { ascending: false }
  );
  if (error || !canonicalData) {
    if (error) logger.error({ err: error, box_id, canonicalStatus }, "listLifecycleNotesByBox failed");
    return [];
  }
  let rows = canonicalData as Note[];

  if (!branchId) return rows;

  const { listPendingOps } = await import(
    "@/server/services/pending_op_service"
  );
  const ops = await listPendingOps(supabase, branchId);
  const unarchiveIds = new Set(
    ops
      .filter((o) => o.object_type === "note" && o.op_type === "unarchive")
      .map((o) => o.object_id)
  );
  const matchingIds = ops
    .filter((o) => o.object_type === "note" && o.op_type === pendingOpType)
    .map((o) => o.object_id);

  // For archived listing: hide canonical rows the branch has unarchived.
  if (canonicalStatus === NOTE_STATUS.ARCHIVED) {
    rows = rows.filter((r) => !unarchiveIds.has(r.id));
  }

  // Pull main-active rows that carry a pending `pendingOpType` op on
  // this branch and merge them in. They keep canonical status=active
  // but render in the archived/trashed tab for the branch view.
  if (matchingIds.length > 0) {
    const { data: overlayData } = await supabase
      .from("notes")
      .select(NOTE_LIST_COLS)
      .eq("box_id", box_id)
      .is("branch_id", null)
      .in("id", matchingIds);
    const existingIds = new Set(rows.map((r) => r.id));
    for (const n of (overlayData ?? []) as Note[]) {
      if (!existingIds.has(n.id)) rows.push(n);
    }
  }

  return rows;
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
    .select(NOTE_FULL_COLS)
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

  if (error || !data) {
    if (error) logger.error({ err: error, box_id }, "listAllNotesByBox failed");
    return [];
  }
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
    .select(NOTE_FULL_COLS)
    .in("id", ids);

  if (error || !data) {
    if (error) logger.error({ err: error }, "getNotesByIds failed");
    return [];
  }
  return data as Note[];
}

/**
 * List the most recently updated active notes in a workspace.
 *
 * Joins through `boxes` since `notes` has no `workspace_id` column — the
 * embedded `boxes!inner(workspace_id)` filter keeps the scoping at the
 * database level. Used by the app sidebar's "Recent" surface to orient
 * the user on every session entry.
 *
 * Branch semantics follow the same contract as `listNotesByBox`:
 *   - branchId = null → main-only view (branch_id IS NULL)
 *   - branchId = <uuid> → only rows with that exact branch_id (for the
 *     sidebar we keep it simple and scope to main when no branch is
 *     active; passing a branch uuid surfaces only branch-local rows).
 */
export async function listRecentNotesByWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { limit?: number; branchId?: string | null } = {}
): Promise<Note[]> {
  const limit = opts.limit ?? 5;
  const { data, error } = await supabase
    .from("notes")
    .select(`${NOTE_LIST_COLS}, boxes!inner(workspace_id)`)
    .eq("boxes.workspace_id", workspaceId)
    .eq("status", NOTE_STATUS.ACTIVE)
    .is("branch_id", opts.branchId ?? null)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) {
    logger.error({ err: error, workspaceId }, "listRecentNotesByWorkspace failed");
    return [];
  }
  return (data ?? []) as Note[];
}
