import { type SupabaseClient } from "@supabase/supabase-js";
import { type Box } from "@/server/domain/types/box";
import { type Folder } from "@/server/domain/types/folder";
import { type Note } from "@/server/domain/types/note";
import { type NoteLink } from "@/server/domain/types/note_link";
import { type ObjectLink } from "@/server/domain/types/object_link";
import { listFoldersByBox } from "@/server/repositories/folder_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import { listFilesByBox } from "@/server/repositories/file_repository";
import { listSkillsByBox } from "@/server/repositories/skill_repository";
import { listAgentsByBox } from "@/server/repositories/agent_repository";
import {
  listLinksFromNote,
} from "@/server/repositories/note_link_repository";

/**
 * Overview service — box hierarchy + full object graph.
 *
 * Hard limits: 1000 nodes, 2000 edges.
 * When truncated, the `truncated` flag is set and the caller should show a notice.
 *
 * Nodes represent folders, notes, files, skills, and agents (non-trashed only).
 * Edges represent note_links within the box and object_links between box objects.
 *
 * This is intentionally a flat-list + edge representation rather than a
 * tree structure — callers can build a tree themselves if needed. The overview
 * surface is primarily for AI context and summary displays.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type OverviewNodeKind = "folder" | "note" | "file" | "skill" | "agent";

export interface OverviewNode {
  id: string;
  kind: OverviewNodeKind;
  label: string;
  /** path_cache within box */
  path: string;
  /** For notes: kind field (note | guide | bundle) */
  noteKind?: string;
  /** Parent folder id — null means root level */
  parentFolderId: string | null;
  /** For folders: id of parent folder. For other types: folder_id. */
  parentId: string | null;
  /** Whether this is a reusable attachment (skills/agents) */
  isReusable?: boolean;
  /** Whether this is attached by reference */
  isAttachment?: boolean;
}

export interface OverviewEdge {
  id: string;
  sourceNoteId: string;
  targetNoteId: string;
  relationshipType: string;
  relationshipNote: string | null;
  /** Edge kind: "note_link" for note-to-note, "object_link" for cross-type */
  edgeKind?: "note_link" | "object_link";
  /** For object_links: source and target types */
  sourceType?: string;
  targetType?: string;
}

export interface BoxOverview {
  box: Box;
  nodes: OverviewNode[];
  edges: OverviewEdge[];
  folderCount: number;
  noteCount: number;
  fileCount: number;
  skillCount: number;
  agentCount: number;
  edgeCount: number;
  truncated: boolean;
}

const NODE_LIMIT = 1000;
const EDGE_LIMIT = 2000;

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getBoxOverview(
  supabase: SupabaseClient,
  box: Box,
  {
    branchId = null,
  }: {
    /**
     * When set, the overview includes rows whose branch_id matches the
     * given branch in addition to the main (branch_id IS NULL) rows.
     * Default null → canonical main-only view (what MCP / API paths want).
     */
    branchId?: string | null;
  } = {}
): Promise<BoxOverview> {
  const [folders, notes, files, skills, agents] = await Promise.all([
    listFoldersByBox(supabase, box.id, { branchId }),
    listNotesByBox(supabase, box.id, { branchId }),
    listFilesByBox(supabase, box.id, { branchId }),
    listSkillsByBox(supabase, box.id),
    listAgentsByBox(supabase, box.id),
  ]);

  // Build note id set for edge filtering (only include intra-box edges)
  const noteIdSet = new Set(notes.map((n) => n.id));

  // Collect all outgoing links for notes in this box
  const linkArrays = await Promise.all(
    notes.map((n) => listLinksFromNote(supabase, n.id))
  );
  const allLinks: NoteLink[] = linkArrays.flat();
  const uniqueLinks = [...new Map(allLinks.map((l) => [l.id, l])).values()];
  const boxLinks = uniqueLinks.filter(
    (l) => noteIdSet.has(l.source_note_id) && noteIdSet.has(l.target_note_id)
  );

  // Collect object_links for cross-type relationships within the box
  const allObjectIds = new Set<string>([
    ...folders.map((f) => f.id),
    ...notes.map((n) => n.id),
    ...files.map((f) => f.id),
    ...skills.map((s) => s.id),
    ...agents.map((a) => a.id),
  ]);

  // Query object_links where either source or target is in this box's objects
  let objectLinks: ObjectLink[] = [];
  if (allObjectIds.size > 0 && box.workspace_id) {
    const { data: olData } = await supabase
      .from("object_links")
      .select("*")
      .eq("workspace_id", box.workspace_id)
      .order("created_at", { ascending: true })
      .limit(EDGE_LIMIT);
    if (olData) {
      // Filter to intra-box links only
      objectLinks = (olData as ObjectLink[]).filter(
        (l) => allObjectIds.has(l.source_object_id) && allObjectIds.has(l.target_object_id)
      );
    }
  }

  // Build nodes: folders, notes, files, skills, agents
  const folderNodes: OverviewNode[] = folders.map((f: Folder) => ({
    id: f.id,
    kind: "folder" as const,
    label: f.name,
    path: f.path_cache,
    parentId: f.parent_folder_id,
    parentFolderId: f.parent_folder_id,
  }));

  const noteNodes: OverviewNode[] = notes.map((n: Note) => ({
    id: n.id,
    kind: "note" as const,
    label: n.title,
    path: n.path_cache,
    noteKind: n.kind,
    parentFolderId: n.folder_id,
    parentId: n.folder_id,
  }));

  const fileNodes: OverviewNode[] = files.map((f) => ({
    id: f.id,
    kind: "file" as const,
    label: f.name,
    path: f.path_cache ?? "",
    parentFolderId: f.folder_id,
    parentId: f.folder_id,
  }));

  const skillNodes: OverviewNode[] = skills.map((s) => ({
    id: s.id,
    kind: "skill" as const,
    label: s.name,
    path: s.path_cache ?? "",
    parentFolderId: s.folder_id,
    parentId: s.folder_id,
    isReusable: s.is_reusable,
  }));

  const agentNodes: OverviewNode[] = agents.map((a) => ({
    id: a.id,
    kind: "agent" as const,
    label: a.name,
    path: a.path_cache ?? "",
    parentFolderId: a.folder_id,
    parentId: a.folder_id,
    isReusable: a.is_reusable,
  }));

  const allNodes = [...folderNodes, ...noteNodes, ...fileNodes, ...skillNodes, ...agentNodes];
  const truncatedNodes = allNodes.length > NODE_LIMIT;
  const totalEdgeCount = boxLinks.length + objectLinks.length;
  const truncatedEdges = totalEdgeCount > EDGE_LIMIT;
  const truncated = truncatedNodes || truncatedEdges;

  // Build unified edge list from both note_links and object_links
  const noteLinkEdges: OverviewEdge[] = boxLinks
    .slice(0, EDGE_LIMIT)
    .map((l: NoteLink) => ({
      id: l.id,
      sourceNoteId: l.source_note_id,
      targetNoteId: l.target_note_id,
      relationshipType: l.relationship_type,
      relationshipNote: l.relationship_note,
      edgeKind: "note_link" as const,
      sourceType: "note",
      targetType: "note",
    }));

  const remainingEdgeSlots = Math.max(0, EDGE_LIMIT - noteLinkEdges.length);
  const objectLinkEdges: OverviewEdge[] = objectLinks
    .slice(0, remainingEdgeSlots)
    .map((l: ObjectLink) => ({
      id: l.id,
      sourceNoteId: l.source_object_id,
      targetNoteId: l.target_object_id,
      relationshipType: l.relationship_type,
      relationshipNote: l.relationship_note,
      edgeKind: "object_link" as const,
      sourceType: l.source_object_type,
      targetType: l.target_object_type,
    }));

  const edges = [...noteLinkEdges, ...objectLinkEdges];

  return {
    box,
    nodes: allNodes.slice(0, NODE_LIMIT),
    edges,
    folderCount: folders.length,
    noteCount: notes.length,
    fileCount: files.length,
    skillCount: skills.length,
    agentCount: agents.length,
    edgeCount: totalEdgeCount,
    truncated,
  };
}
