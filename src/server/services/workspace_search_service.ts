import { type SupabaseClient } from "@supabase/supabase-js";
import {
  searchCacheKey,
  getCachedSearch,
  setCachedSearch,
} from "@/lib/search_query_cache";

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
  /**
   * Note kind ('note' | 'guide' | 'bundle') for note hits; null for
   * non-note object types. Surfaced so the UI can render kind facets
   * and badges without re-querying.
   */
  kind: "note" | "guide" | "bundle" | null;
  /**
   * Tag list for hits that carry tags (notes, files, skills, agents);
   * empty array for object types that have no tags column. Surfaced
   * so the UI can render tag facets and chips without re-querying.
   */
  tags: string[];
}

/**
 * Facet filters applied as Postgres WHERE clauses *before* ranking.
 *
 *   - boxIds      — restrict to hits inside one of these boxes
 *                   (workspace-scoped boxes themselves are still
 *                   surfaced when their own id is in the set).
 *   - dateRange   — ISO date strings filtered against `updated_at`.
 *                   `from` is inclusive (>=); `to` is inclusive (<=).
 *   - kinds       — restrict notes to one of 'note' | 'guide' | 'bundle'.
 *                   Non-note object types are unaffected — the kind
 *                   facet is a note-level concept, so files/skills/
 *                   agents/folders/boxes are excluded entirely when
 *                   `kinds` is set.
 *   - tags        — any-match (OR) against the `tags` text[] column on
 *                   notes, files, skills, and agents. Tables without a
 *                   tags column (folders, boxes) are excluded entirely
 *                   when `tags` is set.
 *
 * An empty array / undefined means "no filter on this facet". When the
 * combination would return zero rows, `searchWorkspace` returns an
 * empty array — it does NOT relax the filter.
 */
export interface SearchFacets {
  boxIds?: string[];
  dateRange?: { from?: string; to?: string };
  kinds?: Array<"note" | "guide" | "bundle">;
  tags?: string[];
}

/**
 * Per-result-set facet counts, used by the UI to render checkbox
 * counts ("Boxes (12)", "Tag: roadmap (4)", etc.).
 */
export interface SearchFacetCounts {
  byBox: Array<{ id: string; name: string; count: number }>;
  byKind: Record<"note" | "guide" | "bundle", number>;
  byTag: Array<{ tag: string; count: number }>;
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
    /**
     * Optional facet filters. Applied as additional WHERE clauses
     * *before* per-table ranking. Empty / undefined = no filter.
     */
    facets?: SearchFacets;
    /**
     * Authenticated user id. When provided, results are cached for
     * 60s in the hot-query cache (`src/lib/search_query_cache.ts`)
     * keyed per-(workspace, user). The userId segment is required
     * for cache participation: branch overlay and role-based
     * filtering can produce per-user results, so we must never
     * serve one user's cached hits to another.
     */
    userId?: string;
  } = {}
): Promise<WorkspaceSearchHit[]> {
  const q = rawQuery.trim();
  if (!q) return [];

  // branch_only without a branchId is a logic error on the caller's
  // side — there is no branch to scope to. Return empty results
  // instead of silently falling back to main (branch_id IS NULL),
  // which would leak main-only data into a branch-only search.
  if (opts.branchScope === "branch_only" && !opts.branchId) {
    return [];
  }

  // Hot-query cache lookup. Only participate when a userId is
  // available — keying by user is a privacy guard, not an
  // optimisation. Branch + scope are folded into the facets-portion
  // of the key so a query repeated against the same branch returns
  // the cached set, while crossing branches misses (correctly).
  const cacheKey =
    opts.userId
      ? searchCacheKey(workspaceId, opts.userId, q, {
          facets: opts.facets ?? null,
          branchId: opts.branchId ?? null,
          branchScope: opts.branchScope ?? null,
          limitPerType: opts.limitPerType ?? null,
        })
      : null;
  if (cacheKey) {
    const hit = await getCachedSearch<WorkspaceSearchHit[]>(cacheKey);
    if (hit) return hit;
  }

  const perType = opts.limitPerType ?? MAX_PER_TYPE;
  const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
  // PostgREST plfts (plainto_tsquery) value — escape parens / colons so
  // the tsquery parser doesn't choke on user input.
  const ftsQ = q.replace(/[():&|!<>]/g, " ").trim();
  const branchId = opts.branchId ?? null;
  const branchScope = opts.branchScope;
  const facets = opts.facets ?? {};
  const facetBoxIds = facets.boxIds && facets.boxIds.length > 0
    ? facets.boxIds : null;
  const facetKinds = facets.kinds && facets.kinds.length > 0
    ? facets.kinds : null;
  const facetTags = facets.tags && facets.tags.length > 0
    ? facets.tags : null;
  const facetFrom = facets.dateRange?.from;
  const facetTo = facets.dateRange?.to;

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
      // When branch_only is requested without a branchId, return the
      // query unchanged — but we short-circuit the entire search to
      // empty results before this point (see early return below).
      // This guard is defensive; the early return in searchWorkspace
      // handles the real case.
      if (!branchId) return q.eq("branch_id", "__no_branch__");
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

  /**
   * Apply the box / date-range facets uniformly. Box and date-range
   * apply to every table that has matching columns (notes, files,
   * skills, agents, folders, boxes — all have box_id except boxes
   * itself, which we handle by matching `id` instead). The kind +
   * tags facets are table-specific and applied at the per-query call
   * site below.
   *
   * `withBoxIdCol` lets us swap `box_id` for `id` on the `boxes`
   * table without duplicating the helper.
   */
  const applyFacets = <Q>(
    query: Q,
    opts: { boxIdCol?: "box_id" | "id" } = {}
  ): Q => {
    type Filterable = {
      in: (c: string, v: readonly unknown[]) => Q;
      gte: (c: string, v: unknown) => Q;
      lte: (c: string, v: unknown) => Q;
    };
    const q = query as unknown as Filterable;
    const boxCol = opts.boxIdCol ?? "box_id";
    let out: Q = query;
    if (facetBoxIds) {
      out = (out as unknown as Filterable).in(boxCol, facetBoxIds);
    }
    if (facetFrom) {
      out = (out as unknown as Filterable).gte("updated_at", facetFrom);
    }
    if (facetTo) {
      out = (out as unknown as Filterable).lte("updated_at", facetTo);
    }
    // reference q so unused-var checks don't fire if both date bounds
    // are absent and box facet is also absent.
    void q;
    return out;
  };

  /**
   * Apply the tag facet (any-match) using the PostgREST `overlaps`
   * (`ov`) operator on a text[] column. Empty `facetTags` is a no-op.
   */
  const applyTagFacet = <Q>(query: Q): Q => {
    type Filterable = {
      overlaps: (c: string, v: readonly string[]) => Q;
    };
    if (!facetTags) return query;
    return (query as unknown as Filterable).overlaps("tags", facetTags);
  };

  // Tags are only present on notes / files / skills / agents.
  // Folders + boxes have no tags column, so a tag facet excludes them
  // entirely. Likewise the kind facet is a notes-only concept; when
  // set we drop non-note types from the result mix.
  const tagsExcludeNonTagged = facetTags !== null;
  const kindsExcludeNonNote = facetKinds !== null;
  // Files / skills / agents are not affected by `kind` (which is
  // notes-only), so a kind facet also drops them.
  const skipFiles = kindsExcludeNonNote;
  const skipSkills = kindsExcludeNonNote;
  const skipAgents = kindsExcludeNonNote;
  const skipFolders = tagsExcludeNonTagged || kindsExcludeNonNote;
  const skipBoxes = tagsExcludeNonTagged || kindsExcludeNonNote;

  const emptyRows: Promise<Array<Record<string, unknown>>> = Promise.resolve([]);

  // Per-table kind filter for notes. Postgres `kind` column lives on
  // `notes`; when `facetKinds` is non-null we restrict to that set.
  const applyNoteKind = <Q>(query: Q): Q => {
    type Filterable = { in: (c: string, v: readonly unknown[]) => Q };
    if (!facetKinds) return query;
    return (query as unknown as Filterable).in("kind", facetKinds);
  };

  const [notes, files, skills, agents, folders, boxes] = await Promise.all([
    // Notes: name + body (notes still use ILIKE — notes FTS is handled
    // by the dedicated search_notes RPC; this cross-type surface keeps
    // the simpler approach for now).
    applyTagFacet(
      applyNoteKind(
        applyFacets(
          applyBranch(
            supabase
              .from("notes")
              .select("id, title, summary, markdown_content, box_id, path_cache, status, updated_at, branch_id, kind, tags")
              .eq("workspace_id", workspaceId)
              .neq("status", "trashed")
          )
        )
      )
    )
      .or(`title.ilike.${like},markdown_content.ilike.${like}`)
      .limit(perType)
      .then((r) => r.data ?? []),

    // Files: FTS via search_vector (name A, description B, source_content C)
    skipFiles
      ? emptyRows
      : applyTagFacet(
          applyFacets(
            applyBranch(
              supabase
                .from("files")
                .select("id, name, box_id, path_cache, source_content, description, status, updated_at, branch_id, tags")
                .eq("workspace_id", workspaceId)
                .neq("status", "trashed")
            )
          )
        )
          .or(`name.ilike.${like},search_vector.plfts.${ftsQ}`)
          .limit(perType)
          .then((r) => r.data ?? []),

    // Skills: FTS via search_vector (name+tags A, description B, source_content C)
    skipSkills
      ? emptyRows
      : applyTagFacet(
          applyFacets(
            applyBranch(
              supabase
                .from("skills")
                .select("id, name, box_id, path_cache, source_content, description, status, updated_at, is_reusable, branch_id, tags")
                .eq("workspace_id", workspaceId)
                .neq("status", "trashed")
            )
          )
        )
          .or(`name.ilike.${like},search_vector.plfts.${ftsQ}`)
          .limit(perType)
          .then((r) => r.data ?? []),

    // Agents: FTS via search_vector (name+tags A, description+system_prompt B, source_content C)
    skipAgents
      ? emptyRows
      : applyTagFacet(
          applyFacets(
            applyBranch(
              supabase
                .from("agents")
                .select("id, name, box_id, path_cache, source_content, description, system_prompt, status, updated_at, is_reusable, branch_id, tags")
                .eq("workspace_id", workspaceId)
                .neq("status", "trashed")
            )
          )
        )
          .or(`name.ilike.${like},search_vector.plfts.${ftsQ}`)
          .limit(perType)
          .then((r) => r.data ?? []),

    skipFolders
      ? emptyRows
      : applyFacets(
          applyBranch(
            supabase
              .from("folders")
              .select("id, name, box_id, path_cache, description, status, updated_at, branch_id")
              .eq("workspace_id", workspaceId)
              .neq("status", "trashed")
          )
        )
          .or(`name.ilike.${like},description.ilike.${like}`)
          .limit(perType)
          .then((r) => r.data ?? []),

    skipBoxes
      ? emptyRows
      : applyFacets(
          supabase
            .from("boxes")
            .select("id, name, description, status, updated_at")
            .eq("workspace_id", workspaceId)
            .neq("status", "trashed"),
          { boxIdCol: "id" }
        )
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
      kind: (n.kind ?? "note") as "note" | "guide" | "bundle",
      tags: n.tags ?? [],
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
      kind: null,
      tags: f.tags ?? [],
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
      kind: null,
      tags: s.tags ?? [],
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
      kind: null,
      tags: a.tags ?? [],
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
      kind: null,
      tags: [],
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
      kind: null,
      tags: [],
      rank,
      href: `/app/boxes/${b.id}`,
    });
  }

  hits.sort((a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  // Fire-and-forget cache write; never blocks the caller.
  if (cacheKey) {
    void setCachedSearch(cacheKey, hits);
  }

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
