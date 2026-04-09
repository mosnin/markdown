"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Box,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Loader2,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getBoxTreeAction } from "@/app/app/boxes/actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type BoxTreeData = {
  folders: Array<{ id: string; name: string; parent_folder_id: string | null; status: string }>;
  notes: Array<{ id: string; title: string; kind: string; folder_id: string | null }>;
};

type TreeNoteNode = {
  id: string;
  title: string;
  kind: string;
};

type TreeFolderNode = {
  id: string;
  name: string;
  children: TreeFolderNode[];
  notes: TreeNoteNode[];
};

export interface TreeSidebarProps {
  boxes: Array<{ id: string; name: string; guide_note_id: string | null }>;
  workspaceName?: string;
  /** Current note ID extracted from URL, if on a note page */
  currentNoteId?: string;
  /** Current box ID extracted from URL, if on a box page */
  currentBoxId?: string;
  onNavigate?: () => void;
}

// ─── Build tree from flat data ────────────────────────────────────────────────

function buildTree(data: BoxTreeData): { rootFolders: TreeFolderNode[]; rootNotes: TreeNoteNode[] } {
  const folderMap = new Map<string, TreeFolderNode>();
  for (const f of data.folders) {
    folderMap.set(f.id, { id: f.id, name: f.name, children: [], notes: [] });
  }

  const rootFolders: TreeFolderNode[] = [];
  for (const f of data.folders) {
    const node = folderMap.get(f.id)!;
    if (f.parent_folder_id && folderMap.has(f.parent_folder_id)) {
      folderMap.get(f.parent_folder_id)!.children.push(node);
    } else {
      rootFolders.push(node);
    }
  }

  const rootNotes: TreeNoteNode[] = [];
  for (const n of data.notes) {
    const item: TreeNoteNode = { id: n.id, title: n.title, kind: n.kind };
    if (n.folder_id && folderMap.has(n.folder_id)) {
      folderMap.get(n.folder_id)!.notes.push(item);
    } else {
      rootNotes.push(item);
    }
  }

  rootFolders.sort((a, b) => a.name.localeCompare(b.name));
  rootNotes.sort((a, b) => a.title.localeCompare(b.title));

  return { rootFolders, rootNotes };
}

// ─── Note icon ────────────────────────────────────────────────────────────────

function noteIcon(kind: string) {
  if (kind === "guide") return BookOpen;
  if (kind === "bundle") return Package;
  return FileText;
}

// ─── Note row ─────────────────────────────────────────────────────────────────

function NoteRow({
  note,
  depth,
  isActive,
  onNavigate,
}: {
  note: TreeNoteNode;
  depth: number;
  isActive: boolean;
  onNavigate?: () => void;
}) {
  const Icon = noteIcon(note.kind);
  return (
    <Link
      href={`/app/notes/${note.id}`}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-1.5 rounded-md py-1 pr-2 text-xs transition-fast",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
      style={{ paddingLeft: `${0.75 + depth * 0.875}rem` }}
      aria-current={isActive ? "page" : undefined}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{note.title}</span>
    </Link>
  );
}

// ─── Folder node ──────────────────────────────────────────────────────────────

function FolderNode({
  folder,
  depth,
  currentNoteId,
  onNavigate,
}: {
  folder: TreeFolderNode;
  depth: number;
  currentNoteId?: string;
  onNavigate?: () => void;
}) {
  return (
    <div>
      <div
        className="flex items-center gap-1.5 rounded-md py-1 pr-2 text-xs text-sidebar-foreground/70"
        style={{ paddingLeft: `${0.75 + depth * 0.875}rem` }}
      >
        <Folder className="h-3 w-3 shrink-0 text-sidebar-foreground/50" aria-hidden="true" />
        <span className="truncate font-medium">{folder.name}</span>
      </div>
      {folder.notes.map((note) => (
        <NoteRow
          key={note.id}
          note={note}
          depth={depth + 1}
          isActive={note.id === currentNoteId}
          onNavigate={onNavigate}
        />
      ))}
      {folder.children.map((child) => (
        <FolderNode
          key={child.id}
          folder={child}
          depth={depth + 1}
          currentNoteId={currentNoteId}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

// ─── Box tree ─────────────────────────────────────────────────────────────────

function BoxTree({
  data,
  currentNoteId,
  onNavigate,
}: {
  data: BoxTreeData;
  currentNoteId?: string;
  onNavigate?: () => void;
}) {
  const { rootFolders, rootNotes } = buildTree(data);
  const empty = rootFolders.length === 0 && rootNotes.length === 0;

  if (empty) {
    return (
      <p className="px-3 py-1.5 text-xs text-sidebar-foreground/40 italic">
        No content yet
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 pb-1">
      {rootFolders.map((folder) => (
        <FolderNode
          key={folder.id}
          folder={folder}
          depth={1}
          currentNoteId={currentNoteId}
          onNavigate={onNavigate}
        />
      ))}
      {rootNotes.map((note) => (
        <NoteRow
          key={note.id}
          note={note}
          depth={1}
          isActive={note.id === currentNoteId}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

// ─── Box row ──────────────────────────────────────────────────────────────────

function BoxRow({
  box,
  isExpanded,
  isBoxActive,
  isLoading,
  treeData,
  currentNoteId,
  onToggle,
  onNavigate,
}: {
  box: { id: string; name: string; guide_note_id: string | null };
  isExpanded: boolean;
  isBoxActive: boolean;
  isLoading: boolean;
  treeData: BoxTreeData | undefined;
  currentNoteId?: string;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const Chevron = isExpanded ? ChevronDown : ChevronRight;

  return (
    <div>
      {/* Box header row */}
      <div className="flex items-center gap-0.5">
        {/* Chevron toggle */}
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded transition-fast",
            "text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
          aria-label={isExpanded ? `Collapse ${box.name}` : `Expand ${box.name}`}
          aria-expanded={isExpanded}
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <Chevron className="h-3 w-3" aria-hidden="true" />
          )}
        </button>

        {/* Box name link */}
        <Link
          href={`/app/boxes/${box.id}`}
          onClick={onNavigate}
          aria-current={isBoxActive ? "page" : undefined}
          className={cn(
            "flex flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition-fast",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isBoxActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <Box className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{box.name}</span>
        </Link>
      </div>

      {/* Expanded tree */}
      {isExpanded && (
        <div className="ml-3">
          {treeData ? (
            <BoxTree
              data={treeData}
              currentNoteId={currentNoteId}
              onNavigate={onNavigate}
            />
          ) : isLoading ? null : (
            <p className="px-3 py-1.5 text-xs text-sidebar-foreground/40 italic">
              No content yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tree sidebar ─────────────────────────────────────────────────────────────

export function TreeSidebar({
  boxes,
  workspaceName,
  currentNoteId,
  currentBoxId,
  onNavigate,
}: TreeSidebarProps) {
  const [expandedBoxIds, setExpandedBoxIds] = useState<Set<string>>(new Set());
  const [treeData, setTreeData] = useState<Map<string, BoxTreeData>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());

  // Auto-expand active box on mount
  useEffect(() => {
    const activeBoxId = currentBoxId;
    if (!activeBoxId) return;
    setExpandedBoxIds((prev) => {
      if (prev.has(activeBoxId)) return prev;
      return new Set([...prev, activeBoxId]);
    });
    // Fetch tree data if not already loaded
    setTreeData((prev) => {
      if (prev.has(activeBoxId)) return prev;
      // Trigger fetch
      fetchTree(activeBoxId);
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchTree(boxId: string) {
    setLoading((prev) => new Set([...prev, boxId]));
    try {
      const result = await getBoxTreeAction(boxId);
      if (result.ok) {
        setTreeData((prev) => new Map([...prev, [boxId, result.data]]));
      }
    } finally {
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(boxId);
        return next;
      });
    }
  }

  function toggleBox(boxId: string) {
    const willExpand = !expandedBoxIds.has(boxId);
    setExpandedBoxIds((prev) => {
      const next = new Set(prev);
      if (next.has(boxId)) {
        next.delete(boxId);
      } else {
        next.add(boxId);
      }
      return next;
    });
    if (willExpand && !treeData.has(boxId) && !loading.has(boxId)) {
      fetchTree(boxId);
    }
  }

  return (
    <nav aria-label="Boxes" className="flex flex-col gap-0.5 px-1">
      {boxes.length === 0 ? (
        <p className="px-2.5 py-2 text-xs text-sidebar-foreground/40">
          No boxes yet
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5 list-none">
          {boxes.map((box) => (
            <li key={box.id}>
              <BoxRow
                box={box}
                isExpanded={expandedBoxIds.has(box.id)}
                isBoxActive={box.id === currentBoxId}
                isLoading={loading.has(box.id)}
                treeData={treeData.get(box.id)}
                currentNoteId={currentNoteId}
                onToggle={() => toggleBox(box.id)}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
