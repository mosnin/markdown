import { type SupabaseClient } from "@supabase/supabase-js";
import { listBranchHeads, type BranchHeadObjectType } from "./branch_service";
import {
  listPendingOps,
  type PendingOp,
  type PendingOpObjectType,
  type PendingOpType,
} from "./pending_op_service";

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
  /**
   * Package-grouped view over `rows` + metadata overlays. Skills and
   * Agents appear as package groups; standalone notes / files /
   * orphan child files fall under `standalone`. Populated when any
   * package row or overlay exists; otherwise `packages` is empty and
   * everything lives in `standalone`.
   */
  packages: PackageDiffGroup[];
  standalone: BranchDiffRow[];
  /**
   * Pending structural ops recorded against main rows (trash,
   * archive, unarchive, move, detach). These don't have branch_heads
   * rows — they live in `branch_pending_ops` — but they're part of
   * what promote will apply to main so the diff view has to surface
   * them. See `docs/branch_local_structural_creation_v1.md`.
   */
  pendingOps: PendingOpDiffRow[];
  /**
   * Folder-branch overrides (rename / reparent / reorder intents)
   * recorded against main folder rows. Each row summarises the
   * changed fields between main and the overlay. See
   * `folder_branch_service`.
   */
  folderOverrides: FolderOverrideDiffRow[];
}

/**
 * Diff row for a single branch_folder_overrides entry. `changes` is
 * populated only with fields where the overlay differs from main —
 * NULL override fields are "no override" and are skipped.
 */
export interface FolderOverrideDiffRow {
  folderId: string;
  folderName: string;
  changes: Array<{ field: string; mainValue: unknown; branchValue: unknown }>;
}

/**
 * Display-ready row for a `branch_pending_ops` entry. `displayName`
 * is resolved from the canonical main row when possible and falls
 * back to a "(missing)" label.
 */
export interface PendingOpDiffRow {
  id: string;
  opType: PendingOpType;
  objectType: PendingOpObjectType;
  objectId: string;
  displayName: string;
  /** Route to the canonical object, when one exists for this type. */
  href: string | null;
  /**
   * Move ops carry a payload describing the target location — we
   * preserve the raw JSON so the UI can render a "from → to"
   * representation if it wants. For trash / archive / unarchive /
   * detach the payload is typically empty.
   */
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * A single Skill or Agent package group in the diff view.
 *
 * `canonical` is the branch diff row for the package's own
 * canonical source, when it has one. `children` are file diff rows
 * whose canonical row has `parent_skill_id` / `parent_agent_id`
 * pointing at this package. `metadataChanges` are fields the user
 * overrode on the branch_package_metadata overlay with a
 * before/after comparison against main. Empty arrays are valid — a
 * package might appear in the diff because of overlay-only changes.
 */
export interface PackageDiffGroup {
  packageType: "skill" | "agent";
  packageId: string;
  packageName: string;
  packageHref: string;
  canonical: BranchDiffRow | null;
  children: BranchDiffRow[];
  metadataChanges: PackageMetadataChange[];
}

export interface PackageMetadataChange {
  field: string;
  mainValue: unknown;
  branchValue: unknown;
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

  // Branch-local structural creates (files + object_links) have no
  // corresponding branch_heads row — they are new rows marked with
  // branch_id. Surface them in the diff as synthetic "created on
  // branch" entries so the user sees what promote will add to main.
  const createdFiles = await loadBranchCreatedFiles(supabase, branchId);
  nonNull.push(...createdFiles);

  let totalBytesAdded = 0;
  let totalBytesRemoved = 0;
  for (const r of nonNull) {
    const delta = r.branchBytes - r.mainBytes;
    if (delta > 0) totalBytesAdded += delta;
    else totalBytesRemoved += Math.abs(delta);
  }

  const { packages, standalone } = await groupRowsIntoPackages(
    supabase,
    branchId,
    nonNull
  );

  const pendingOps = await loadPendingOpRows(supabase, branchId);
  const folderOverrides = await loadFolderOverrideRows(supabase, branchId);

  return {
    branchId,
    branchName: branch.name,
    headCount: heads.length,
    rows: nonNull,
    totalBytesAdded,
    totalBytesRemoved,
    packages,
    standalone,
    pendingOps,
    folderOverrides,
  };
}

/**
 * Load every folder-branch override for the branch and diff each
 * against its canonical folder row. Overrides where no field
 * differs from main are dropped (no-op overlays).
 */
async function loadFolderOverrideRows(
  supabase: SupabaseClient,
  branchId: string
): Promise<FolderOverrideDiffRow[]> {
  const { data: overrides } = await supabase
    .from("folder_branch_overrides")
    .select("*")
    .eq("branch_id", branchId);
  const rows = (overrides ?? []) as Array<{
    folder_id: string;
    name: string | null;
    parent_folder_id: string | null;
    sort_order: number | null;
    path_cache: string | null;
  }>;
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.folder_id);
  const { data: folders } = await supabase
    .from("folders")
    .select("id, name, parent_folder_id, path_cache")
    .in("id", ids);
  const folderById = new Map<
    string,
    { id: string; name: string; parent_folder_id: string | null; path_cache: string }
  >();
  for (const f of (folders ?? []) as Array<{
    id: string;
    name: string;
    parent_folder_id: string | null;
    path_cache: string;
  }>) {
    folderById.set(f.id, f);
  }

  // sort_order lives in workspace_objects, not on folders. Resolve
  // in one bulk call so the diff surfaces reorder intent correctly.
  const { data: woRows } = await supabase
    .from("workspace_objects")
    .select("object_id, sort_order")
    .eq("object_type", "folder")
    .in("object_id", ids);
  const sortOrderById = new Map<string, number | null>();
  for (const r of (woRows ?? []) as Array<{ object_id: string; sort_order: number | null }>) {
    sortOrderById.set(r.object_id, r.sort_order ?? null);
  }

  const out: FolderOverrideDiffRow[] = [];
  for (const ov of rows) {
    const main = folderById.get(ov.folder_id);
    const changes: FolderOverrideDiffRow["changes"] = [];
    if (ov.name !== null && main && main.name !== ov.name) {
      changes.push({ field: "name", mainValue: main.name, branchValue: ov.name });
    }
    if (ov.parent_folder_id !== null && main && main.parent_folder_id !== ov.parent_folder_id) {
      changes.push({
        field: "parent_folder_id",
        mainValue: main.parent_folder_id,
        branchValue: ov.parent_folder_id,
      });
    }
    if (ov.path_cache !== null && main && main.path_cache !== ov.path_cache) {
      changes.push({
        field: "path_cache",
        mainValue: main.path_cache,
        branchValue: ov.path_cache,
      });
    }
    if (ov.sort_order !== null) {
      const mainSort = sortOrderById.get(ov.folder_id) ?? null;
      if (mainSort !== ov.sort_order) {
        changes.push({ field: "sort_order", mainValue: mainSort, branchValue: ov.sort_order });
      }
    }
    if (changes.length === 0) continue;
    out.push({
      folderId: ov.folder_id,
      folderName: main?.name ?? "(missing folder)",
      changes,
    });
  }
  return out;
}

/**
 * Resolve every pending op on the branch into a UI-friendly row.
 * Bulk-fetches display names per object type so rendering doesn't
 * round-trip once per op.
 */
async function loadPendingOpRows(
  supabase: SupabaseClient,
  branchId: string
): Promise<PendingOpDiffRow[]> {
  const ops = await listPendingOps(supabase, branchId);
  if (ops.length === 0) return [];

  const byType = new Map<PendingOpObjectType, string[]>();
  for (const op of ops) {
    const ids = byType.get(op.object_type) ?? [];
    ids.push(op.object_id);
    byType.set(op.object_type, ids);
  }

  const nameMap = new Map<string, string>();
  const tableFor: Record<PendingOpObjectType, { table: string; nameCol: string } | null> = {
    note: { table: "notes", nameCol: "title" },
    file: { table: "files", nameCol: "name" },
    folder: { table: "folders", nameCol: "name" },
    skill: { table: "skills", nameCol: "name" },
    agent: { table: "agents", nameCol: "name" },
    object_link: null,
    box_object_attachment: null,
  };
  for (const [type, ids] of byType) {
    const spec = tableFor[type];
    if (!spec || ids.length === 0) continue;
    const { data } = await supabase
      .from(spec.table)
      .select(`id, ${spec.nameCol}`)
      .in("id", ids);
    for (const row of ((data ?? []) as unknown) as Array<Record<string, unknown>>) {
      const id = String(row.id);
      const name = row[spec.nameCol];
      nameMap.set(`${type}:${id}`, typeof name === "string" ? name : "");
    }
  }

  return ops.map((op: PendingOp): PendingOpDiffRow => {
    const key = `${op.object_type}:${op.object_id}`;
    const name = nameMap.get(key);
    const href = hrefForPendingOp(op.object_type, op.object_id);
    return {
      id: op.id,
      opType: op.op_type,
      objectType: op.object_type,
      objectId: op.object_id,
      displayName: name && name.length > 0 ? name : `(missing ${op.object_type})`,
      href,
      payload: op.payload,
      createdAt: op.created_at,
    };
  });
}

function hrefForPendingOp(type: PendingOpObjectType, id: string): string | null {
  switch (type) {
    case "note":
      return `/app/notes/${id}`;
    case "file":
      return `/app/files/${id}`;
    case "skill":
      return `/app/skills/${id}`;
    case "agent":
      return `/app/agents/${id}`;
    case "folder":
    case "object_link":
    case "box_object_attachment":
      return null;
  }
}

/**
 * Turn a flat list of branch diff rows into package-grouped
 * structures.
 *
 * A row is "packaged" if:
 *   1. It's a skill or agent head directly, OR
 *   2. It's a file head whose canonical row has a non-null
 *      parent_skill_id / parent_agent_id.
 *
 * Rows that don't match either criterion are standalone (notes,
 * box-level files that aren't children of any skill / agent).
 *
 * On top of rows we also pull every `branch_package_metadata` row
 * for the branch; a package appears in the grouped view if it has
 * overlay rows even when it has no branch_heads.
 */
async function groupRowsIntoPackages(
  supabase: SupabaseClient,
  branchId: string,
  rows: BranchDiffRow[]
): Promise<{ packages: PackageDiffGroup[]; standalone: BranchDiffRow[] }> {
  // Pull parent pointers + package names for every file row in one
  // shot so we don't issue N queries.
  const fileIds = rows.filter((r) => r.objectType === "file").map((r) => r.objectId);
  const fileParents = new Map<
    string,
    { parent_skill_id: string | null; parent_agent_id: string | null }
  >();
  if (fileIds.length > 0) {
    const { data } = await supabase
      .from("files")
      .select("id, parent_skill_id, parent_agent_id")
      .in("id", fileIds);
    for (const row of data ?? []) {
      fileParents.set(row.id, {
        parent_skill_id: row.parent_skill_id ?? null,
        parent_agent_id: row.parent_agent_id ?? null,
      });
    }
  }

  interface GroupAccum {
    packageType: "skill" | "agent";
    packageId: string;
    canonical: BranchDiffRow | null;
    children: BranchDiffRow[];
  }
  const groups = new Map<string, GroupAccum>();
  const standalone: BranchDiffRow[] = [];

  function keyFor(type: "skill" | "agent", id: string) {
    return `${type}:${id}`;
  }
  function ensureGroup(type: "skill" | "agent", id: string): GroupAccum {
    const k = keyFor(type, id);
    const existing = groups.get(k);
    if (existing) return existing;
    const fresh: GroupAccum = { packageType: type, packageId: id, canonical: null, children: [] };
    groups.set(k, fresh);
    return fresh;
  }

  for (const row of rows) {
    if (row.objectType === "skill" || row.objectType === "agent") {
      ensureGroup(row.objectType, row.objectId).canonical = row;
      continue;
    }
    if (row.objectType === "file") {
      const parents = fileParents.get(row.objectId);
      if (parents?.parent_skill_id) {
        ensureGroup("skill", parents.parent_skill_id).children.push(row);
        continue;
      }
      if (parents?.parent_agent_id) {
        ensureGroup("agent", parents.parent_agent_id).children.push(row);
        continue;
      }
    }
    standalone.push(row);
  }

  // Pull every metadata overlay for this branch and resolve before/
  // after pairs against main. Overlay rows whose package didn't show
  // up in groups yet still get a group entry (metadata-only drafts).
  const { data: overlays } = await supabase
    .from("branch_package_metadata")
    .select("*")
    .eq("branch_id", branchId);

  const metadataChangesByKey = new Map<string, PackageMetadataChange[]>();
  for (const o of overlays ?? []) {
    const key = `${o.package_type}:${o.package_id}`;
    ensureGroup(o.package_type as "skill" | "agent", o.package_id);
    const changes = await deriveMetadataChanges(supabase, o);
    if (changes.length > 0) metadataChangesByKey.set(key, changes);
  }

  // Resolve package display names for the grouped view in one round
  // per type.
  const skillIds = Array.from(groups.values())
    .filter((g) => g.packageType === "skill")
    .map((g) => g.packageId);
  const agentIds = Array.from(groups.values())
    .filter((g) => g.packageType === "agent")
    .map((g) => g.packageId);
  const nameMap = new Map<string, string>();
  if (skillIds.length > 0) {
    const { data } = await supabase.from("skills").select("id, name").in("id", skillIds);
    for (const r of data ?? []) nameMap.set(`skill:${r.id}`, r.name);
  }
  if (agentIds.length > 0) {
    const { data } = await supabase.from("agents").select("id, name").in("id", agentIds);
    for (const r of data ?? []) nameMap.set(`agent:${r.id}`, r.name);
  }

  const packages: PackageDiffGroup[] = Array.from(groups.values()).map((g) => {
    const key = keyFor(g.packageType, g.packageId);
    return {
      packageType: g.packageType,
      packageId: g.packageId,
      packageName: nameMap.get(key) ?? `(deleted ${g.packageType})`,
      packageHref: g.packageType === "skill"
        ? `/app/skills/${g.packageId}`
        : `/app/agents/${g.packageId}`,
      canonical: g.canonical,
      children: g.children,
      metadataChanges: metadataChangesByKey.get(key) ?? [],
    };
  });

  // Sort packages alphabetically for stable rendering.
  packages.sort((a, b) => a.packageName.localeCompare(b.packageName));
  return { packages, standalone };
}

/**
 * Derive the set of metadata fields that actually changed between
 * main and the overlay. We treat null / undefined symmetrically on
 * main (a cleared field and a never-set field are both "no value")
 * and compare primitives + arrays for equality. `tags` uses
 * set-equality to ignore reorders.
 */
async function deriveMetadataChanges(
  supabase: SupabaseClient,
  overlay: {
    package_type: string;
    package_id: string;
    description: string | null;
    tags: string[] | null;
    summary: string | null;
    agent_type: string | null;
    model_hint: string | null;
    system_prompt: string | null;
  }
): Promise<PackageMetadataChange[]> {
  const table = overlay.package_type === "skill" ? "skills" : "agents";
  const cols = overlay.package_type === "skill"
    ? "id, description, tags, summary"
    : "id, description, tags, summary, agent_type, model_hint, system_prompt";
  const { data: main } = await supabase
    .from(table)
    .select(cols)
    .eq("id", overlay.package_id)
    .maybeSingle();
  const overlayObj = overlay as unknown as Record<string, unknown>;
  const mainObj = (main ?? {}) as Record<string, unknown>;

  const fields = overlay.package_type === "skill"
    ? (["description", "tags", "summary"] as const)
    : (["description", "tags", "summary", "agent_type", "model_hint", "system_prompt"] as const);

  const out: PackageMetadataChange[] = [];
  for (const f of fields) {
    const overlayVal = overlayObj[f];
    if (overlayVal === undefined) continue;
    const mainVal = mainObj[f] ?? null;
    if (valuesEqual(mainVal, overlayVal)) continue;
    out.push({ field: f, mainValue: mainVal, branchValue: overlayVal });
  }
  return out;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const as = [...a].sort();
    const bs = [...b].sort();
    for (let i = 0; i < as.length; i++) if (as[i] !== bs[i]) return false;
    return true;
  }
  return false;
}

/**
 * Load files that exist only on this branch (branch_id matches, no
 * main counterpart). Each one becomes a BranchDiffRow where
 * mainContent=null and mainBytes=0 so the UI renders it as
 * "new on branch" — the same shape the deleted-on-main edge case
 * uses today.
 */
async function loadBranchCreatedFiles(
  supabase: SupabaseClient,
  branchId: string
): Promise<BranchDiffRow[]> {
  const { data } = await supabase
    .from("files")
    .select("id, name, source_content, content_bytes, current_version_id, path_cache, parent_skill_id, parent_agent_id")
    .eq("branch_id", branchId);
  return (data ?? []).map((f: {
    id: string;
    name: string;
    source_content: string;
    content_bytes: number;
    current_version_id: string | null;
    path_cache: string | null;
    parent_skill_id: string | null;
    parent_agent_id: string | null;
  }) => ({
    branchHeadId: `created:${f.id}`,
    objectType: "file" as const,
    objectId: f.id,
    displayName: f.name,
    href: `/app/files/${f.id}`,
    branchVersionId: f.current_version_id ?? "",
    branchContent: f.source_content,
    branchBytes: f.content_bytes,
    branchVersionNumber: 1,
    mainVersionId: null,
    mainContent: null,
    mainBytes: 0,
    mainMovedAhead: false,
    mainTrashed: false,
  }));
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
