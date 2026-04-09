import { type SupabaseClient } from "@supabase/supabase-js";
import { type Box } from "@/server/domain/types/box";
import { type Folder } from "@/server/domain/types/folder";
import { type Note } from "@/server/domain/types/note";
import { type NoteLink } from "@/server/domain/types/note_link";
import { listFoldersByBox } from "@/server/repositories/folder_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import {
  listLinksFromNote,
} from "@/server/repositories/note_link_repository";

/**
 * Overview service — box hierarchy + note link graph.
 *
 * Hard limits: 1000 nodes, 2000 edges.
 * When truncated, the `truncated` flag is set and the caller should show a notice.
 *
 * Nodes represent folders and notes (non-trashed only).
 * Edges represent note_links within the box.
 *
 * This is intentionally a flat-list + edge representation rather than a
 * tree structure — callers can build a tree themselves if needed. The overview
 * surface is primarily for AI context and summary displays.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type OverviewNodeKind = "folder" | "note";

export interface OverviewNode {
  id: string;
  kind: OverviewNodeKind;
  label: string;
  /** For notes: path_cache within box */
  path: string;
  /** For notes: kind field (note | guide | bundle) */
  noteKind?: string;
  /** For notes: null means root level */
  parentFolderId: string | null;
  /** For folders: id of parent folder */
  parentId: string | null;
}

export interface OverviewEdge {
  id: string;
  sourceNoteId: string;
  targetNoteId: string;
  relationshipType: string;
}

export interface BoxOverview {
  box: Box;
  nodes: OverviewNode[];
  edges: OverviewEdge[];
  folderCount: number;
  noteCount: number;
  edgeCount: number;
  truncated: boolean;
}

const NODE_LIMIT = 1000;
const EDGE_LIMIT = 2000;

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getBoxOverview(
  supabase: SupabaseClient,
  box: Box
): Promise<BoxOverview> {
  const [folders, notes] = await Promise.all([
    listFoldersByBox(supabase, box.id),
    listNotesByBox(supabase, box.id),
  ]);

  // Build note id set for edge filtering (only include intra-box edges)
  const noteIdSet = new Set(notes.map((n) => n.id));

  // Collect all outgoing links for notes in this box
  const linkArrays = await Promise.all(
    notes.map((n) => listLinksFromNote(supabase, n.id))
  );
  const allLinks: NoteLink[] = linkArrays.flat();
  // Deduplicate by id (shouldn't be needed but be safe)
  const uniqueLinks = [...new Map(allLinks.map((l) => [l.id, l])).values()];
  // Keep only intra-box edges
  const boxLinks = uniqueLinks.filter(
    (l) => noteIdSet.has(l.source_note_id) && noteIdSet.has(l.target_note_id)
  );

  // Build nodes: folders first, then notes
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

  const allNodes = [...folderNodes, ...noteNodes];
  const truncatedNodes = allNodes.length > NODE_LIMIT;
  const truncatedEdges = boxLinks.length > EDGE_LIMIT;
  const truncated = truncatedNodes || truncatedEdges;

  const edges: OverviewEdge[] = boxLinks
    .slice(0, EDGE_LIMIT)
    .map((l: NoteLink) => ({
      id: l.id,
      sourceNoteId: l.source_note_id,
      targetNoteId: l.target_note_id,
      relationshipType: l.relationship_type,
    }));

  return {
    box,
    nodes: allNodes.slice(0, NODE_LIMIT),
    edges,
    folderCount: folders.length,
    noteCount: notes.length,
    edgeCount: boxLinks.length,
    truncated,
  };
}
