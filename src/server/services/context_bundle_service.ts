import { type SupabaseClient } from "@supabase/supabase-js";
import { type Note } from "@/server/domain/types/note";
import {
  type ContextBundle,
  type BundleNoteRef,
  type BundleLinkedNote,
  type BundleParentPath,
  type BundleVersionInfo,
} from "@/server/domain/types/context_bundle";
import { getNoteById, getNotesByIds, listNotesByBox } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { getFolderById } from "@/server/repositories/folder_repository";
import { getNoteVersionById } from "@/server/repositories/note_version_repository";
import {
  listLinksFromNote,
  listLinksToNote,
} from "@/server/repositories/note_link_repository";

/**
 * Context Bundle Service.
 *
 * Assembles a bounded, deterministic retrieval package centered on one note.
 * All ownership verification happens here — pages and actions must not bypass it.
 *
 * Assembly pipeline (in order):
 *   1. Resolve target note (error if not found)
 *   2. Verify workspace ownership through the note's box
 *   3. Resolve current version metadata
 *   4. Build parent folder path (root → immediate parent)
 *   5. Include guide note if requested and present
 *   6. Fetch and rank all explicitly linked notes; apply linked_limit
 *   7. Resolve ancestor summary note (deterministic walk up folder chain)
 *   8. Apply deduplication across all included notes
 *   9. Build relationship_edges for included linked_notes
 *  10. Produce truncation_reasons
 *  11. Return assembled ContextBundle
 *
 * Hard limits:
 *   - linked_limit: default 10, max 10
 *   - guide_note: at most 1
 *   - ancestor_summary_note: at most 1
 *   - No recursive expansion of linked notes
 *   - No full-box traversal
 *   - Trashed content: never included
 *   - Archived content: excluded unless include_archived = true
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of linked notes to include in any bundle. Hard ceiling. */
const LINKED_LIMIT_MAX = 10;

/**
 * Maximum folder levels to walk during ancestor summary resolution.
 * Prevents unbounded walking in unusually deep trees.
 */
const FOLDER_WALK_LIMIT = 20;

/**
 * Relationship importance scores for bundle-level ranking.
 * Lower score = higher importance (appears earlier in linked_notes).
 *
 * Mapping from existing relationship_type values to the canonical
 * importance ordering:
 *   extends    → 3  (like "derived_from" — builds on the target)
 *   references → 2  (like "reference_for" — cites the target)
 *   supersedes → 10 (exact match — replaces the target)
 *   related    → 6  (exact match — general association)
 *   contradicts → 11 (not in ideal list; conflicts are least useful for bounded context)
 *
 * Unknown types get score 7 (between "related" and "sibling_of").
 */
const RELATIONSHIP_IMPORTANCE: Record<string, number> = {
  extends: 3,
  references: 2,
  supersedes: 10,
  related: 6,
  contradicts: 11,
};

/**
 * Read-hint priority for secondary ranking within linked notes and ancestor
 * summary selection.
 * Lower score = higher priority.
 *   'core_reference' → 1  (highest; marks notes that must be read for orientation)
 *   'read_first'     → 2  (high; marks entry-point notes)
 *   other non-null   → 3
 *   null             → 4  (no hint; lowest)
 */
const READ_HINT_PRIORITY: Record<string, number> = {
  core_reference: 1,
  read_first: 2,
};

/**
 * read_hint values that make a note eligible as an ancestor summary note.
 * Only these exact string values qualify.
 */
const ANCESTOR_SUMMARY_ELIGIBLE_HINTS = new Set(["core_reference", "read_first"]);

// ─── Ranking helpers ──────────────────────────────────────────────────────────

function getRelationshipImportance(type: string): number {
  return RELATIONSHIP_IMPORTANCE[type] ?? 7;
}

function getReadHintPriority(readHint: string | null): number {
  if (!readHint) return 4;
  return READ_HINT_PRIORITY[readHint] ?? 3;
}

/**
 * Rank a note title for ancestor summary selection.
 * Exact title match is preferred:
 *   "Overview" → 0 (highest)
 *   "Summary"  → 1
 *   other      → 2
 */
function getTitleRank(title: string): number {
  if (title === "Overview") return 0;
  if (title === "Summary") return 1;
  return 2;
}

// ─── Note reference builder ───────────────────────────────────────────────────

/**
 * Derive the parent folder's path from the note's own path_cache.
 * The note path is `<folder_path>/<note_slug>`, so folder_path is everything
 * before the last '/'. Returns null for root-level notes (no folder).
 */
function deriveFolderPathCache(
  pathCache: string,
  folderId: string | null
): string | null {
  if (!folderId) return null;
  const segments = pathCache.split("/");
  segments.pop();
  return segments.length > 0 ? segments.join("/") : null;
}

function toNoteRef(note: Note): BundleNoteRef {
  return {
    id: note.id,
    box_id: note.box_id,
    folder_id: note.folder_id,
    title: note.title,
    kind: note.kind,
    status: note.status,
    summary: note.summary,
    read_hint: note.read_hint,
    retrieval_priority: note.retrieval_priority,
    tags: note.tags,
    path_cache: note.path_cache,
    folder_path_cache: deriveFolderPathCache(note.path_cache, note.folder_id),
    updated_at: note.updated_at,
  };
}

// ─── Parent path builder ──────────────────────────────────────────────────────

/**
 * Walk up the folder chain from startFolderId toward root, collecting each
 * ancestor. Returns folders ordered root-first.
 *
 * At most FOLDER_WALK_LIMIT levels are walked; deeper hierarchies are truncated.
 */
async function buildParentPath(
  supabase: SupabaseClient,
  startFolderId: string | null
): Promise<BundleParentPath> {
  if (!startFolderId) {
    return { folder_ids: [], folder_names: [], path_cache: null };
  }

  const chain: Array<{ id: string; name: string; pathCache: string }> = [];
  let currentId: string | null = startFolderId;
  let level = 0;

  while (currentId && level < FOLDER_WALK_LIMIT) {
    const folder = await getFolderById(supabase, currentId);
    if (!folder) break;
    // Prepend to build root-first order
    chain.unshift({
      id: folder.id,
      name: folder.name,
      pathCache: folder.path_cache,
    });
    currentId = folder.parent_folder_id;
    level++;
  }

  return {
    folder_ids: chain.map((f) => f.id),
    folder_names: chain.map((f) => f.name),
    path_cache: chain.length > 0 ? chain[chain.length - 1].pathCache : null,
  };
}

// ─── Ancestor summary resolution ──────────────────────────────────────────────

/**
 * Resolve a single ancestor summary note by walking up the folder chain.
 *
 * Algorithm (deterministic):
 *   1. Start at startFolderId (the target note's own folder).
 *   2. At each folder level, query active non-trashed notes with
 *      read_hint IN ('core_reference', 'read_first'), excluding excludeIds.
 *   3. Rank candidates at each level by:
 *      a. read_hint: 'core_reference' before 'read_first'
 *      b. title: exact "Overview" before "Summary" before others
 *      c. retrieval_priority descending (nulls treated as 0)
 *      d. updated_at descending
 *      e. id ascending (stable tie-break)
 *   4. If candidates exist at this level, return the top-ranked one.
 *   5. If none, walk to parent_folder_id and repeat.
 *   6. If root is reached with no candidates, return null.
 *
 * Constraints:
 *   - Does not search the entire box
 *   - Does not use semantic heuristics
 *   - Walks at most FOLDER_WALK_LIMIT levels
 */
async function resolveAncestorSummary(
  supabase: SupabaseClient,
  boxId: string,
  startFolderId: string,
  excludeIds: Set<string>,
  includeArchived: boolean
): Promise<Note | null> {
  let currentFolderId: string | null = startFolderId;
  let level = 0;

  while (currentFolderId && level < FOLDER_WALK_LIMIT) {
    // Fetch all notes in this specific folder
    const notesInFolder = await listNotesByBox(supabase, boxId, {
      folder_id: currentFolderId,
      includeArchived,
    });

    // Filter: must have eligible read_hint and not be in the exclude set
    const candidates = notesInFolder.filter(
      (n) =>
        !excludeIds.has(n.id) &&
        n.read_hint !== null &&
        ANCESTOR_SUMMARY_ELIGIBLE_HINTS.has(n.read_hint)
    );

    if (candidates.length > 0) {
      // Rank candidates deterministically
      candidates.sort((a, b) => {
        // a. read_hint priority
        const rh =
          getReadHintPriority(a.read_hint) - getReadHintPriority(b.read_hint);
        if (rh !== 0) return rh;

        // b. title rank
        const tr = getTitleRank(a.title) - getTitleRank(b.title);
        if (tr !== 0) return tr;

        // c. retrieval_priority descending
        if (a.retrieval_priority !== b.retrieval_priority) {
          return b.retrieval_priority - a.retrieval_priority;
        }

        // d. updated_at descending
        if (a.updated_at !== b.updated_at) {
          return b.updated_at.localeCompare(a.updated_at);
        }

        // e. id ascending (stable)
        return a.id.localeCompare(b.id);
      });

      return candidates[0];
    }

    // Walk up to parent
    const folder = await getFolderById(supabase, currentFolderId);
    currentFolderId = folder?.parent_folder_id ?? null;
    level++;
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AssembleBundleOptions {
  /** Include the box's guide note if one is assigned. Default: true. */
  includeGuide?: boolean;
  /** Include archived linked notes in the candidate pool. Default: false. */
  includeArchived?: boolean;
  /** Max linked notes to include. Clamped to LINKED_LIMIT_MAX (10). Default: 10. */
  linkedLimit?: number;
  /** Attempt to resolve an ancestor summary note. Default: true. */
  includeAncestorSummary?: boolean;
}

/**
 * Assemble a context bundle for the given note.
 *
 * @throws Error('Note not found') if the note does not exist
 * @throws Error('Not found') if the note's box does not belong to workspaceId
 */
export async function assembleContextBundle(
  supabase: SupabaseClient,
  workspaceId: string,
  noteId: string,
  options: AssembleBundleOptions = {}
): Promise<ContextBundle> {
  const {
    includeGuide = true,
    includeArchived = false,
    linkedLimit = LINKED_LIMIT_MAX,
    includeAncestorSummary = true,
  } = options;

  const effectiveLinkedLimit = Math.min(
    Math.max(1, linkedLimit),
    LINKED_LIMIT_MAX
  );
  const truncationReasons: string[] = [];

  // ── 1. Resolve target note ──────────────────────────────────────────────
  const targetNote = await getNoteById(supabase, noteId);
  if (!targetNote) throw new Error("Note not found");

  // ── 2. Verify workspace ownership ───────────────────────────────────────
  const box = await getBoxById(supabase, targetNote.box_id);
  if (!box || box.workspace_id !== workspaceId) throw new Error("Not found");

  // ── 3. Current version info ─────────────────────────────────────────────
  let versionInfo: BundleVersionInfo = {
    current_version_id: targetNote.current_version_id,
    updated_at: targetNote.updated_at,
    version_created_at: null,
    change_origin: null,
  };

  if (targetNote.current_version_id) {
    const version = await getNoteVersionById(
      supabase,
      targetNote.current_version_id
    );
    if (version) {
      versionInfo = {
        current_version_id: version.id,
        updated_at: targetNote.updated_at,
        version_created_at: version.created_at,
        change_origin: version.change_origin,
      };
    }
  }

  // ── 4. Parent path ──────────────────────────────────────────────────────
  const parentPath = await buildParentPath(supabase, targetNote.folder_id);

  // ── 5. Guide note ───────────────────────────────────────────────────────
  let guideNote: BundleNoteRef | null = null;

  if (includeGuide && box.guide_note_id) {
    // Guide must not be the same as the target note
    if (box.guide_note_id !== noteId) {
      const guide = await getNoteById(supabase, box.guide_note_id);
      if (guide && guide.status !== "trashed") {
        if (guide.status !== "archived" || includeArchived) {
          guideNote = toNoteRef(guide);
        }
      }
    }
  } else if (!includeGuide && box.guide_note_id && box.guide_note_id !== noteId) {
    // Guide exists but was excluded by option
    truncationReasons.push("guide_excluded_by_option");
  }

  // ── 6. Fetch and rank linked notes ──────────────────────────────────────
  // The set of note ids to never include (target + guide)
  const alwaysExclude = new Set<string>([noteId]);
  if (guideNote) alwaysExclude.add(guideNote.id);

  const [outgoingLinks, incomingLinks] = await Promise.all([
    listLinksFromNote(supabase, noteId),
    listLinksToNote(supabase, noteId),
  ]);

  // Collect unique candidate note ids from both link directions
  const linkedNoteIds = new Set<string>();
  for (const l of outgoingLinks) linkedNoteIds.add(l.target_note_id);
  for (const l of incomingLinks) linkedNoteIds.add(l.source_note_id);

  const candidateIds = [...linkedNoteIds].filter(
    (id) => !alwaysExclude.has(id)
  );

  // Bulk-fetch candidate notes
  const rawCandidates = await getNotesByIds(supabase, candidateIds);

  // Filter by status and box ownership
  let archivedExcluded = false;
  const filteredCandidates = rawCandidates.filter((n) => {
    if (n.box_id !== box.id) return false; // must be same box
    if (n.status === "trashed") return false; // always exclude trashed
    if (n.status === "archived" && !includeArchived) {
      archivedExcluded = true;
      return false;
    }
    return true;
  });

  if (archivedExcluded) {
    truncationReasons.push("archived_excluded");
  }

  // Build linked note objects with the most-important-direction relationship
  const linkedNoteCandidates: BundleLinkedNote[] = [];

  for (const note of filteredCandidates) {
    const outLink = outgoingLinks.find((l) => l.target_note_id === note.id);
    const inLink = incomingLinks.find((l) => l.source_note_id === note.id);

    let chosenLink: { id: string; relationship_type: string };
    let chosenDirection: "outgoing" | "incoming";

    if (outLink && inLink) {
      // Both directions exist — choose the more important relationship
      const outImportance = getRelationshipImportance(outLink.relationship_type);
      const inImportance = getRelationshipImportance(inLink.relationship_type);
      if (outImportance <= inImportance) {
        chosenLink = { id: outLink.id, relationship_type: outLink.relationship_type };
        chosenDirection = "outgoing";
      } else {
        chosenLink = { id: inLink.id, relationship_type: inLink.relationship_type };
        chosenDirection = "incoming";
      }
    } else if (outLink) {
      chosenLink = { id: outLink.id, relationship_type: outLink.relationship_type };
      chosenDirection = "outgoing";
    } else if (inLink) {
      chosenLink = { id: inLink.id, relationship_type: inLink.relationship_type };
      chosenDirection = "incoming";
    } else {
      continue; // no link found (shouldn't happen)
    }

    linkedNoteCandidates.push({
      ...toNoteRef(note),
      relationship_type: chosenLink.relationship_type,
      direction: chosenDirection,
      link_id: chosenLink.id,
    });
  }

  // Sort by deterministic ranking criteria
  linkedNoteCandidates.sort((a, b) => {
    // 1. Relationship importance (lower score = higher priority)
    const imp =
      getRelationshipImportance(a.relationship_type) -
      getRelationshipImportance(b.relationship_type);
    if (imp !== 0) return imp;

    // 2. Read hint priority (lower score = higher priority)
    const rh =
      getReadHintPriority(a.read_hint) - getReadHintPriority(b.read_hint);
    if (rh !== 0) return rh;

    // 3. Retrieval priority descending
    if (a.retrieval_priority !== b.retrieval_priority) {
      return b.retrieval_priority - a.retrieval_priority;
    }

    // 4. Updated at descending
    if (a.updated_at !== b.updated_at) {
      return b.updated_at.localeCompare(a.updated_at);
    }

    // 5. Stable id ascending (deterministic tie-break)
    return a.id.localeCompare(b.id);
  });

  const totalLinkedAvailable = linkedNoteCandidates.length;
  const linkedNotes = linkedNoteCandidates.slice(0, effectiveLinkedLimit);

  if (totalLinkedAvailable > effectiveLinkedLimit) {
    truncationReasons.push("linked_limit_reached");
  }

  // ── 7. Ancestor summary note ────────────────────────────────────────────
  let ancestorSummaryNote: BundleNoteRef | null = null;

  if (includeAncestorSummary) {
    if (targetNote.folder_id) {
      // Build exclude set: target + guide + all included linked notes
      // (ancestor must not duplicate any already-included note)
      const ancestorExclude = new Set<string>([
        noteId,
        ...(guideNote ? [guideNote.id] : []),
        ...linkedNotes.map((ln) => ln.id),
      ]);

      const ancestor = await resolveAncestorSummary(
        supabase,
        targetNote.box_id,
        targetNote.folder_id,
        ancestorExclude,
        includeArchived
      );

      if (ancestor) {
        ancestorSummaryNote = toNoteRef(ancestor);
      } else {
        truncationReasons.push("ancestor_summary_not_found");
      }
    } else {
      // Target note is at root level — no folder ancestors
      truncationReasons.push("ancestor_summary_not_found");
    }
  }

  // ── 8. Relationship edges for included linked notes ─────────────────────
  const includedLinkIds = new Set(linkedNotes.map((ln) => ln.link_id));
  const allLinks = [...outgoingLinks, ...incomingLinks];
  const relationshipEdges = allLinks
    .filter((l) => includedLinkIds.has(l.id))
    .map((l) => ({
      link_id: l.id,
      source_note_id: l.source_note_id,
      target_note_id: l.target_note_id,
      relationship_type: l.relationship_type,
    }));

  // ── 9. Assemble bundle ──────────────────────────────────────────────────
  const uniqueReasons = [...new Set(truncationReasons)];
  const truncated = uniqueReasons.length > 0;

  return {
    target_note: toNoteRef(targetNote),
    box: {
      id: box.id,
      name: box.name,
      slug: box.slug,
      workspace_id: box.workspace_id,
      guide_note_id: box.guide_note_id,
    },
    parent_path: parentPath,
    guide_note: guideNote,
    linked_notes: linkedNotes,
    ancestor_summary_note: ancestorSummaryNote,
    relationship_edges: relationshipEdges,
    version_info: versionInfo,
    truncated,
    truncation_reasons: uniqueReasons,
    assembly_metadata: {
      assembled_at: new Date().toISOString(),
      include_guide: includeGuide,
      include_archived: includeArchived,
      include_ancestor_summary: includeAncestorSummary,
      linked_limit: effectiveLinkedLimit,
      total_linked_available: totalLinkedAvailable,
    },
  };
}
