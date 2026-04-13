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
  /**
   * Package-grouped view over `rows` + metadata overlays. Skills and
   * Agents appear as package groups; standalone notes / files /
   * orphan child files fall under `standalone`. Populated when any
   * package row or overlay exists; otherwise `packages` is empty and
   * everything lives in `standalone`.
   */
  packages: PackageDiffGroup[];
  standalone: BranchDiffRow[];
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

  return {
    branchId,
    branchName: branch.name,
    headCount: heads.length,
    rows: nonNull,
    totalBytesAdded,
    totalBytesRemoved,
    packages,
    standalone,
  };
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
