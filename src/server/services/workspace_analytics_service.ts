import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Workspace analytics & content health service.
 *
 * Provides workspace-wide metrics: content counts, contributor
 * activity, search analytics, and content health indicators such as
 * orphaned notes (no inbound/outbound links) and stale content.
 */

// ─── Search analytics recording ─────────────────────────────────────────────

export interface RecordSearchQueryInput {
  workspaceId: string;
  userId?: string | null;
  query: string;
  resultCount: number;
  searchType?: "keyword" | "semantic" | "hybrid";
}

/**
 * Record a search query for analytics. Fire-and-forget — errors are
 * swallowed so search latency is never impacted.
 */
export async function recordSearchQuery(
  supabase: SupabaseClient,
  input: RecordSearchQueryInput,
): Promise<void> {
  try {
    await supabase.from("search_analytics").insert({
      workspace_id: input.workspaceId,
      user_id: input.userId ?? null,
      query: input.query,
      result_count: input.resultCount,
      search_type: input.searchType ?? "keyword",
    });
  } catch (err) {
    console.error("[analytics] Failed to record search query", err);
  }
}

// ─── Workspace metrics ──────────────────────────────────────────────────────

export interface WorkspaceMetrics {
  totalNotes: number;
  totalFiles: number;
  totalFolders: number;
  totalBoxes: number;
  totalSkills: number;
  totalAgents: number;
  notesCreatedThisWeek: number;
  notesCreatedThisMonth: number;
  activeContributors: number;
  topSearchQueries: Array<{ query: string; count: number }>;
  orphanedNotes: Array<{ id: string; title: string; updatedAt: string }>;
  busiestBoxes: Array<{ id: string; name: string; noteCount: number }>;
}

/**
 * Aggregate workspace metrics for the analytics dashboard. Runs
 * multiple queries in parallel for speed.
 */
export async function getWorkspaceMetrics(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceMetrics> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    notesResult,
    filesResult,
    foldersResult,
    boxesResult,
    skillsResult,
    agentsResult,
    notesThisWeekResult,
    notesThisMonthResult,
    activeContributorsResult,
    topQueriesResult,
    orphanedResult,
    busiestBoxesResult,
  ] = await Promise.all([
    // Total counts — only active (not trashed/archived) and main-only
    supabase
      .from("notes")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("branch_id", null)
      .eq("status", "active"),
    supabase
      .from("files")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("branch_id", null)
      .eq("status", "active"),
    supabase
      .from("folders")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("branch_id", null)
      .eq("status", "active"),
    supabase
      .from("boxes")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "active"),
    supabase
      .from("skills")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("branch_id", null)
      .eq("status", "active"),
    supabase
      .from("agents")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("branch_id", null)
      .eq("status", "active"),

    // Notes created this week
    supabase
      .from("notes")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("branch_id", null)
      .gte("created_at", weekAgo),

    // Notes created this month
    supabase
      .from("notes")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("branch_id", null)
      .gte("created_at", monthAgo),

    // Active contributors: distinct actors in audit_events last 7 days
    supabase
      .from("audit_events")
      .select("actor_id")
      .eq("workspace_id", workspaceId)
      .eq("actor_type", "user")
      .gte("created_at", weekAgo),

    // Top search queries last 30 days
    supabase
      .from("search_analytics")
      .select("query")
      .eq("workspace_id", workspaceId)
      .gte("created_at", monthAgo),

    // Orphaned notes: notes with zero links (no inbound or outbound)
    getOrphanedNotes(supabase, workspaceId),

    // Busiest boxes by note count
    getBusiestBoxes(supabase, workspaceId),
  ]);

  // Deduplicate active contributors
  const uniqueActors = new Set<string>();
  if (activeContributorsResult.data) {
    for (const row of activeContributorsResult.data) {
      uniqueActors.add(row.actor_id);
    }
  }

  // Aggregate top search queries
  const queryCounts = new Map<string, number>();
  if (topQueriesResult.data) {
    for (const row of topQueriesResult.data) {
      const q = (row.query as string).toLowerCase().trim();
      queryCounts.set(q, (queryCounts.get(q) ?? 0) + 1);
    }
  }
  const topSearchQueries = Array.from(queryCounts.entries())
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalNotes: notesResult.count ?? 0,
    totalFiles: filesResult.count ?? 0,
    totalFolders: foldersResult.count ?? 0,
    totalBoxes: boxesResult.count ?? 0,
    totalSkills: skillsResult.count ?? 0,
    totalAgents: agentsResult.count ?? 0,
    notesCreatedThisWeek: notesThisWeekResult.count ?? 0,
    notesCreatedThisMonth: notesThisMonthResult.count ?? 0,
    activeContributors: uniqueActors.size,
    topSearchQueries,
    orphanedNotes: orphanedResult,
    busiestBoxes: busiestBoxesResult,
  };
}

// ─── Content health ─────────────────────────────────────────────────────────

export interface ContentHealthReport {
  orphanedNotes: Array<{ id: string; title: string; updatedAt: string }>;
  emptyFolders: Array<{ id: string; name: string; boxId: string }>;
  staleNotes: Array<{ id: string; title: string; updatedAt: string }>;
}

/**
 * Content health scan: orphaned notes, empty folders, stale notes.
 */
export async function getContentHealth(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ContentHealthReport> {
  const ninetyDaysAgo = new Date(
    Date.now() - 90 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [orphaned, emptyFolders, stale] = await Promise.all([
    getOrphanedNotes(supabase, workspaceId),
    getEmptyFolders(supabase, workspaceId),
    getStaleNotes(supabase, workspaceId, ninetyDaysAgo),
  ]);

  return {
    orphanedNotes: orphaned,
    emptyFolders,
    staleNotes: stale,
  };
}

// ─── Contributor activity ───────────────────────────────────────────────────

export interface ContributorActivity {
  userId: string;
  eventCount: number;
}

/**
 * Per-user event counts over the given time window.
 */
export async function getContributorActivity(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { days?: number } = {},
): Promise<ContributorActivity[]> {
  const days = opts.days ?? 7;
  const since = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data } = await supabase
    .from("audit_events")
    .select("actor_id")
    .eq("workspace_id", workspaceId)
    .eq("actor_type", "user")
    .gte("created_at", since);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.actor_id, (counts.get(row.actor_id) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([userId, eventCount]) => ({ userId, eventCount }))
    .sort((a, b) => b.eventCount - a.eventCount);
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/**
 * Notes with zero inbound AND outbound links. We fetch all active
 * main-branch notes and all note_links, then compute the orphan set
 * in-memory. For workspaces with < 10k notes this is fast and avoids
 * complex SQL sub-selects that PostgREST can't express.
 */
async function getOrphanedNotes(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Array<{ id: string; title: string; updatedAt: string }>> {
  const [notesRes, linksRes] = await Promise.all([
    supabase
      .from("notes")
      .select("id, title, updated_at")
      .eq("workspace_id", workspaceId)
      .is("branch_id", null)
      .eq("status", "active")
      .limit(5000),
    supabase
      .from("note_links")
      .select("source_note_id, target_note_id")
      .limit(10000),
  ]);

  const notes = notesRes.data ?? [];
  const links = linksRes.data ?? [];

  // Build set of note IDs that belong to this workspace
  const wsNoteIds = new Set(notes.map((n) => n.id));

  // Build set of note IDs that have at least one link
  const linked = new Set<string>();
  for (const l of links) {
    if (wsNoteIds.has(l.source_note_id)) linked.add(l.source_note_id);
    if (wsNoteIds.has(l.target_note_id)) linked.add(l.target_note_id);
  }

  return notes
    .filter((n) => !linked.has(n.id))
    .map((n) => ({ id: n.id, title: n.title, updatedAt: n.updated_at }))
    .slice(0, 50);
}

async function getEmptyFolders(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Array<{ id: string; name: string; boxId: string }>> {
  // Fetch all active folders
  const { data: folders } = await supabase
    .from("folders")
    .select("id, name, box_id")
    .eq("workspace_id", workspaceId)
    .is("branch_id", null)
    .eq("status", "active")
    .limit(2000);

  if (!folders || folders.length === 0) return [];

  // Fetch notes grouped by folder — just need IDs
  const { data: notesInFolders } = await supabase
    .from("notes")
    .select("folder_id")
    .eq("workspace_id", workspaceId)
    .is("branch_id", null)
    .eq("status", "active")
    .limit(10000);

  // Check subfolders too
  const { data: subFolders } = await supabase
    .from("folders")
    .select("parent_folder_id")
    .eq("workspace_id", workspaceId)
    .is("branch_id", null)
    .eq("status", "active")
    .limit(5000);

  const foldersWithContent = new Set<string>();
  for (const n of notesInFolders ?? []) {
    if (n.folder_id) foldersWithContent.add(n.folder_id);
  }
  for (const sf of subFolders ?? []) {
    if (sf.parent_folder_id) foldersWithContent.add(sf.parent_folder_id);
  }

  return folders
    .filter((f) => !foldersWithContent.has(f.id))
    .map((f) => ({ id: f.id, name: f.name, boxId: f.box_id }))
    .slice(0, 50);
}

async function getStaleNotes(
  supabase: SupabaseClient,
  workspaceId: string,
  before: string,
): Promise<Array<{ id: string; title: string; updatedAt: string }>> {
  const { data } = await supabase
    .from("notes")
    .select("id, title, updated_at")
    .eq("workspace_id", workspaceId)
    .is("branch_id", null)
    .eq("status", "active")
    .lt("updated_at", before)
    .order("updated_at", { ascending: true })
    .limit(50);

  return (data ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    updatedAt: n.updated_at,
  }));
}

/**
 * Busiest boxes by note count. Returns the top 10 boxes ordered by
 * the number of active notes they contain.
 */
async function getBusiestBoxes(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Array<{ id: string; name: string; noteCount: number }>> {
  // Fetch boxes
  const { data: boxes } = await supabase
    .from("boxes")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .limit(200);

  if (!boxes || boxes.length === 0) return [];

  // Count notes per box
  const { data: notes } = await supabase
    .from("notes")
    .select("box_id")
    .eq("workspace_id", workspaceId)
    .is("branch_id", null)
    .eq("status", "active")
    .limit(10000);

  const counts = new Map<string, number>();
  for (const n of notes ?? []) {
    if (n.box_id) {
      counts.set(n.box_id, (counts.get(n.box_id) ?? 0) + 1);
    }
  }

  const boxMap = new Map(boxes.map((b) => [b.id, b.name]));

  return Array.from(counts.entries())
    .filter(([id]) => boxMap.has(id))
    .map(([id, noteCount]) => ({
      id,
      name: boxMap.get(id) ?? "",
      noteCount,
    }))
    .sort((a, b) => b.noteCount - a.noteCount)
    .slice(0, 10);
}
