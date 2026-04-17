import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Workspace-wide cross-type search.
 *
 * V1 behaviour:
 *   * Scope is the active workspace (every result the caller sees comes
 *     from workspaces they have membership on — RLS filters out the rest).
 *   * Covers notes, files, skills, agents, folders, and boxes.
 *   * Matches on display_name first (ILIKE, case-insensitive) and, for
 *     versioned content objects, also on the body text via ILIKE on
 *     markdown_content / source_content / description. We deliberately
 *     keep the ranking simple: exact / prefix / substring of display_name
 *     outrank body substring hits. Notes additionally carry a stable
 *     FTS-backed score via the existing search_notes RPC when a box_id is
 *     available.
 *   * Results are unified into WorkspaceSearchHit so the search page can
 *     render them with one renderer and route to the correct detail page.
 *
 * The service does not reach into per-type retrieval logic (retrieval
 * priority, guide promotion, read hints); that's the job of the
 * retrieval layer. This surface is for human-driven finding.
 */

export type WorkspaceSearchObjectType =
  | "note"
  | "file"
  | "skill"
  | "agent"
  | "folder"
  | "box";

/**
 * Explicit branch-visibility selector for search.
 *
 *   - `main_only`         → workspace rows with branch_id IS NULL only.
 *   - `main_plus_branch`  → main rows overlaid with the active branch's
 *                           draft rows (same shape as the default
 *                           reader overlay when a branch is active).
 *   - `branch_only`       → only rows authored on the active branch
 *                           (branch_id = <activeBranchId>).
 *
 * When unset, `searchWorkspace` falls back to the legacy behaviour
 * (branchId null → main only; branchId set → main+branch overlay).
 */
export type BranchScope = "main_only" | "main_plus_branch" | "branch_only";

export interface WorkspaceSearchHit {
  objectType: WorkspaceSearchObjectType;
  id: string;
  title: string;
  /** e.g. "research / ideas / 2025-Q4" — the box/folder breadcrumb. */
  path: string | null;
  boxId: string | null;
  boxName: string | null;
  /** Short plain-text snippet or description, ≤ 240 chars. */
  snippet: string | null;
  status: string;
  updatedAt: string;
  /** Server-assigned rank (higher = better). */
  rank: number;
  /** Canonical app route for this hit. */
  href: string;
}

const MAX_PER_TYPE = 12;
const SNIPPET_CHARS = 240;
const TITLE_BASE_RANK = 500;

function clampSnippet(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > SNIPPET_CHARS
    ? trimmed.slice(0, SNIPPET_CHARS - 1) + "…"
    : trimmed;
}

function titleRank(title: string, q: string): number {
  const t = title.toLowerCase();
  const n = q.toLowerCase();
  if (t === n) return TITLE_BASE_RANK + 100;
  if (t.startsWith(n)) return TITLE_BASE_RANK + 50;
  if (t.includes(n)) return TITLE_BASE_RANK + 20;
  return 0;
}

/**
 * Run a workspace-wide search and return ranked, deduplicated hits.
 * Limit is the soft cap per object type; the caller may post-filter to
 * trim the returned list further for display.
 *
 * Branch awareness:
 *   - `branchId = null` → search only main rows (branch_id IS NULL).
 *   - `branchId = <uuid>` → main + rows belonging to the branch; we
 *     additionally drop rows hidden by a pending `trash` op on that
 *     branch so soft-deleted content disappears from search. Other
 *     branches' draft rows never leak in — see
 *     `docs/branch_local_structural_creation_v1.md`.
 */
export async function searchWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
  rawQuery: string,
  opts: {
    boxMap?: Map<string, string>;
    limitPerType?: number;
    branchId?: string | null;
    branchScope?: BranchScope;
  } = {}
): Promise<WorkspaceSearchHit[]> {
  const q = rawQuery.trim();
  if (!q) return [];

  const perType = opts.limitPerType ?? MAX_PER_TYPE;
  const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
  const branchId = opts.branchId ?? null;
  const branchScope = opts.branchScope;

  const boxMap = opts.boxMap
    ?? (await loadBoxMap(supabase, workspaceId));

  // Branch filter helper: attach the branch_id predicate uniformly to
  // any ilike/or'd query builder. Boxes are workspace-scoped and not
  // branch-partitioned — they never carry branch_id.
  //
  // When `branchScope` is explicitly provided, it overrides the legacy
  // branchId-derived behaviour:
  //   - main_only         → branch_id IS NULL
  //   - main_plus_branch  → main + branchId (requires branchId)
  //   - branch_only       → branch_id = branchId (requires branchId)
  // The PostgREST chainable builder is heavily overloaded; a narrow
  // `Q extends {...}` inference explodes the type checker (TS2589), so
  // accept it as a generic and return the same Q.
  const applyBranch = <Q>(query: Q): Q => {
    // Tell TS that `query` responds to the three filter methods we
    // need. We don't depend on the real postgrest filter types here —
    // just the runtime contract.
    type Filterable = {
      or: (e: string) => Q;
      is: (c: string, v: unknown) => Q;
      eq: (c: string, v: unknown) => Q;
    };
    const q = query as unknown as Filterable;
    if (branchScope === "main_only") {
      return q.is("branch_id", null);
    }
    if (branchScope === "branch_only") {
      if (!branchId) return q.is("branch_id", null);
      return q.eq("branch_id", branchId);
    }
    if (branchScope === "main_plus_branch") {
      if (!branchId) return q.is("branch_id", null);
      return q.or(`branch_id.is.null,branch_id.eq.${branchId}`);
    }
    // Legacy default: branchId null → main only; branchId set → overlay.
    if (branchId) {
      return q.or(`branch_id.is.null,branch_id.eq.${branchId}`);
    }
    return q.is("branch_id", null);
  };

  const [notes, files, skills, agents, folders, boxes] = await Promise.all([
    // Notes: name + body
    applyBranch(
      supabase
        .from("notes")
        .select("id, title, summary, markdown_content, box_id, path_cache, status, updated_at, branch_id")
        .eq("workspace_id", workspaceId)
        .neq("status", "trashed")
    )
      .or(`title.ilike.${like},markdown_content.ilike.${like}`)
      .limit(perType)
      .then((r) => r.data ?? []),

    applyBranch(
      supabase
        .from("files")
        .select("id, name, box_id, path_cache, source_content, description, status, updated_at, branch_id")
        .eq("workspace_id", workspaceId)
        .neq("status", "trashed")
    )
      .or(`name.ilike.${like},source_content.ilike.${like}`)
      .limit(perType)
      .then((r) => r.data ?? []),

    applyBranch(
      supabase
        .from("skills")
        .select("id, name, box_id, path_cache, source_content, description, status, updated_at, is_reusable, branch_id")
        .eq("workspace_id", workspaceId)
        .neq("status", "trashed")
    )
      .or(`name.ilike.${like},source_content.ilike.${like}`)
      .limit(perType)
      .then((r) => r.data ?? []),

    applyBranch(
      supabase
        .from("agents")
        .select("id, name, box_id, path_cache, source_content, description, system_prompt, status, updated_at, is_reusable, branch_id")
        .eq("workspace_id", workspaceId)
        .neq("status", "trashed")
    )
      .or(`name.ilike.${like},source_content.ilike.${like},system_prompt.ilike.${like}`)
      .limit(perType)
      .then((r) => r.data ?? []),

    applyBranch(
      supabase
        .from("folders")
        .select("id, name, box_id, path_cache, description, status, updated_at, branch_id")
        .eq("workspace_id", workspaceId)
        .neq("status", "trashed")
    )
      .or(`name.ilike.${like},description.ilike.${like}`)
      .limit(perType)
      .then((r) => r.data ?? []),

    supabase
      .from("boxes")
      .select("id, name, description, status, updated_at")
      .eq("workspace_id", workspaceId)
      .neq("status", "trashed")
      .or(`name.ilike.${like},description.ilike.${like}`)
      .limit(perType)
      .then((r) => r.data ?? []),
  ]);

  // Pending-op overlay: when a branch is active, drop rows the branch
  // has soft-trashed. Matches the reader semantic in
  // note_repository.listNotesByBox and file_repository.listFilesByBox.
  // Skip the overlay when the caller explicitly asked for `main_only`
  // — that scope shouldn't be influenced by any branch's trash ops.
  let hidden: Set<string> | null = null;
  if (branchId && branchScope !== "main_only") {
    const { getHiddenByPendingOps } = await import("./pending_op_service");
    hidden = await getHiddenByPendingOps(supabase, branchId);
  }
  const notVisible = (type: string, id: string) =>
    hidden !== null && hidden.has(`${type}:${id}`);

  const hits: WorkspaceSearchHit[] = [];

  for (const n of notes) {
    if (notVisible("note", n.id)) continue;
    const rank = titleRank(n.title, q)
      || (n.markdown_content?.toLowerCase().includes(q.toLowerCase()) ? 100 : 0);
    hits.push({
      objectType: "note",
      id: n.id,
      title: n.title,
      path: n.path_cache ?? null,
      boxId: n.box_id,
      boxName: n.box_id ? boxMap.get(n.box_id) ?? null : null,
      snippet: clampSnippet(n.summary ?? n.markdown_content),
      status: n.status,
      updatedAt: n.updated_at,
      rank,
      href: `/app/notes/${n.id}`,
    });
  }
  for (const f of files) {
    if (notVisible("file", f.id)) continue;
    const rank = titleRank(f.name, q)
      || (f.source_content?.toLowerCase().includes(q.toLowerCase()) ? 90 : 0);
    hits.push({
      objectType: "file",
      id: f.id,
      title: f.name,
      path: f.path_cache ?? null,
      boxId: f.box_id,
      boxName: f.box_id ? boxMap.get(f.box_id) ?? null : null,
      snippet: clampSnippet(f.description ?? f.source_content),
      status: f.status,
      updatedAt: f.updated_at,
      rank,
      href: `/app/files/${f.id}`,
    });
  }
  for (const s of skills) {
    if (notVisible("skill", s.id)) continue;
    const rank = titleRank(s.name, q)
      || (s.source_content?.toLowerCase().includes(q.toLowerCase()) ? 80 : 0);
    hits.push({
      objectType: "skill",
      id: s.id,
      title: s.name,
      path: s.path_cache ?? null,
      boxId: s.box_id,
      boxName: s.box_id ? boxMap.get(s.box_id) ?? null : null,
      snippet: clampSnippet(s.description ?? s.source_content),
      status: s.status,
      updatedAt: s.updated_at,
      rank,
      href: `/app/skills/${s.id}`,
    });
  }
  for (const a of agents) {
    if (notVisible("agent", a.id)) continue;
    const rank = titleRank(a.name, q)
      || (a.source_content?.toLowerCase().includes(q.toLowerCase()) ? 80 : 0)
      || (a.system_prompt?.toLowerCase().includes(q.toLowerCase()) ? 60 : 0);
    hits.push({
      objectType: "agent",
      id: a.id,
      title: a.name,
      path: a.path_cache ?? null,
      boxId: a.box_id,
      boxName: a.box_id ? boxMap.get(a.box_id) ?? null : null,
      snippet: clampSnippet(a.description ?? a.source_content ?? a.system_prompt),
      status: a.status,
      updatedAt: a.updated_at,
      rank,
      href: `/app/agents/${a.id}`,
    });
  }
  for (const fl of folders) {
    if (notVisible("folder", fl.id)) continue;
    const rank = titleRank(fl.name, q)
      || (fl.description?.toLowerCase().includes(q.toLowerCase()) ? 70 : 0);
    hits.push({
      objectType: "folder",
      id: fl.id,
      title: fl.name,
      path: fl.path_cache ?? null,
      boxId: fl.box_id,
      boxName: fl.box_id ? boxMap.get(fl.box_id) ?? null : null,
      snippet: clampSnippet(fl.description),
      status: fl.status,
      updatedAt: fl.updated_at,
      rank,
      href: `/app/folders/${fl.id}`,
    });
  }
  for (const b of boxes) {
    const rank = titleRank(b.name, q)
      || (b.description?.toLowerCase().includes(q.toLowerCase()) ? 60 : 0);
    hits.push({
      objectType: "box",
      id: b.id,
      title: b.name,
      path: null,
      boxId: b.id,
      boxName: b.name,
      snippet: clampSnippet(b.description),
      status: b.status,
      updatedAt: b.updated_at,
      rank,
      href: `/app/boxes/${b.id}`,
    });
  }

  hits.sort((a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  return hits;
}

async function loadBoxMap(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("boxes")
    .select("id, name")
    .eq("workspace_id", workspaceId);
  const map = new Map<string, string>();
  for (const b of data ?? []) map.set(b.id, b.name);
  return map;
}
