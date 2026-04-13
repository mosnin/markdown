import { type SupabaseClient } from "@supabase/supabase-js";
import { listBranchHeads, type BranchHeadObjectType } from "./branch_service";

/**
 * Branch preview / diff service.
 *
 * Produces a per-head snapshot of what's different between a draft
 * branch's head version and main's current version, for every object
 * the branch has edited. This is what the branch detail page reads
 * before a user promotes — it's the trust surface that makes promote
 * inspectable.
 *
 * Design notes:
 *
 *   * One row per branch_heads entry. Missing main versions (edge
 *     case: object was trashed after the branch wrote) are rendered
 *     with mainContent=null and a mainTrashed flag so the UI can
 *     decide how to present them.
 *   * The full text bodies are returned so the UI can render a real
 *     diff. For very large content the client should use a virtualised
 *     diff viewer; we don't truncate here because the alternative
 *     (elided diffs) is a worse trust signal.
 *   * Non-versioned fields are intentionally NOT surfaced. Titles /
 *     tags / descriptions still come from main — see
 *     docs/branch_aware_writes_v1.md for the "non-versioned field
 *     overrides" deferral.
 */

export interface BranchDiffRow {
  /** branch_heads.id — stable identifier for the head row. */
  branchHeadId: string;
  objectType: BranchHeadObjectType;
  objectId: string;

  /**
   * Display name drawn from the canonical main row. Might lag the
   * branch-side content if the user renamed on main after branching;
   * that's fine because names are not versioned.
   */
  displayName: string;
  /** Canonical route for "open in editor". Branch read-through is
   *  automatic when the user has the active branch cookie set. */
  href: string;

  /** Branch head's version_id. Always set. */
  branchVersionId: string;
  /** Branch head's full content (markdown for notes, source otherwise). */
  branchContent: string;
  branchBytes: number;
  /** Branch head's version_number — monotonic across branch + main. */
  branchVersionNumber: number;

  /**
   * Main's current_version_id at the time of preview. Null only if
   * the object has no canonical current version yet (newly-created
   * and never saved on main — rare but possible for notes created on
   * a branch, which V1 doesn't support but the shape allows).
   */
  mainVersionId: string | null;
  mainContent: string | null;
  mainBytes: number;

  /** Whether main has moved ahead since the branch's last edit.
   *  Surface for a yellow "will overwrite newer main" banner. */
  mainMovedAhead: boolean;
  /** True if the canonical row is trashed. */
  mainTrashed: boolean;
}

export interface BranchDiff {
  branchId: string;
  branchName: string;
  headCount: number;
  rows: BranchDiffRow[];
  /** Convenience totals for the page header. */
  totalBytesAdded: number;
  totalBytesRemoved: number;
}

// ─── Type helpers ────────────────────────────────────────────────────────────

interface NoteMainRow {
  id: string;
  title: string;
  markdown_content: string;
  content_bytes: number;
  current_version_id: string | null;
  status: string;
}

interface ObjectMainRow {
  id: string;
  name: string;
  source_content: string;
  content_bytes: number;
  current_version_id: string | null;
  status: string;
}

interface NoteVersionRow {
  id: string;
  note_id: string;
  parent_version_id: string | null;
  version_number: number;
  markdown_content: string;
  content_bytes: number;
}

interface ObjectVersionRow {
  id: string;
  object_id: string;
  parent_version_id: string | null;
  version_number: number;
  source_content: string;
  content_bytes: number;
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Build a preview of every head on the branch.
 *
 * Parallelises the per-head fetches so a branch with N heads costs
 * ~max(per-head latency) rather than N × latency. Each head resolves
 * to a BranchDiffRow; heads whose canonical row was deleted since
 * the branch wrote are still returned with `mainTrashed = true` so
 * the UI can flag them instead of silently dropping.
 */
export async function getBranchDiff(
  supabase: SupabaseClient,
  branchId: string,
  workspaceId: string
): Promise<BranchDiff | null> {
  const { data: branch } = await supabase
    .from("draft_branches")
    .select("id, workspace_id, name")
    .eq("id", branchId)
    .maybeSingle();
  if (!branch || branch.workspace_id !== workspaceId) return null;

  const heads = await listBranchHeads(supabase, branchId);

  const rows = await Promise.all(
    heads.map((h) => buildDiffRow(supabase, h.id, h.object_type, h.object_id, h.version_id))
  );
  const nonNull = rows.filter((r): r is BranchDiffRow => r !== null);

  let totalBytesAdded = 0;
  let totalBytesRemoved = 0;
  for (const r of nonNull) {
    const delta = r.branchBytes - r.mainBytes;
    if (delta > 0) totalBytesAdded += delta;
    else totalBytesRemoved += Math.abs(delta);
  }

  return {
    branchId,
    branchName: branch.name,
    headCount: heads.length,
    rows: nonNull,
    totalBytesAdded,
    totalBytesRemoved,
  };
}

async function buildDiffRow(
  supabase: SupabaseClient,
  branchHeadId: string,
  objectType: BranchHeadObjectType,
  objectId: string,
  branchVersionId: string
): Promise<BranchDiffRow | null> {
  if (objectType === "note") {
    const { data: main } = await supabase
      .from("notes")
      .select("id, title, markdown_content, content_bytes, current_version_id, status")
      .eq("id", objectId)
      .maybeSingle();
    const { data: branchVer } = await supabase
      .from("note_versions")
      .select("id, note_id, parent_version_id, version_number, markdown_content, content_bytes")
      .eq("id", branchVersionId)
      .maybeSingle();
    if (!branchVer) return null;
    const bv = branchVer as NoteVersionRow;
    const m = main as NoteMainRow | null;

    // Main moved ahead iff main's current_version_id is not the
    // branch head's parent (or null, meaning the branch was never
    // written against a known parent — edge case).
    const mainMovedAhead = !!m?.current_version_id
      && m.current_version_id !== bv.parent_version_id
      && m.current_version_id !== bv.id;

    return {
      branchHeadId,
      objectType,
      objectId,
      displayName: m?.title ?? "(deleted note)",
      href: `/app/notes/${objectId}`,
      branchVersionId: bv.id,
      branchContent: bv.markdown_content,
      branchBytes: bv.content_bytes,
      branchVersionNumber: bv.version_number,
      mainVersionId: m?.current_version_id ?? null,
      mainContent: m?.markdown_content ?? null,
      mainBytes: m?.content_bytes ?? 0,
      mainMovedAhead,
      mainTrashed: m?.status === "trashed",
    };
  }

  // file / skill / agent share the object_versions table.
  const table =
    objectType === "file" ? "files" :
    objectType === "skill" ? "skills" : "agents";

  const { data: main } = await supabase
    .from(table)
    .select("id, name, source_content, content_bytes, current_version_id, status")
    .eq("id", objectId)
    .maybeSingle();
  const { data: branchVer } = await supabase
    .from("object_versions")
    .select("id, object_id, parent_version_id, version_number, source_content, content_bytes")
    .eq("id", branchVersionId)
    .maybeSingle();
  if (!branchVer) return null;
  const bv = branchVer as ObjectVersionRow;
  const m = main as ObjectMainRow | null;

  const mainMovedAhead = !!m?.current_version_id
    && m.current_version_id !== bv.parent_version_id
    && m.current_version_id !== bv.id;

  const href =
    objectType === "file" ? `/app/files/${objectId}` :
    objectType === "skill" ? `/app/skills/${objectId}` : `/app/agents/${objectId}`;

  return {
    branchHeadId,
    objectType,
    objectId,
    displayName: m?.name ?? `(deleted ${objectType})`,
    href,
    branchVersionId: bv.id,
    branchContent: bv.source_content,
    branchBytes: bv.content_bytes,
    branchVersionNumber: bv.version_number,
    mainVersionId: m?.current_version_id ?? null,
    mainContent: m?.source_content ?? null,
    mainBytes: m?.content_bytes ?? 0,
    mainMovedAhead,
    mainTrashed: m?.status === "trashed",
  };
}
