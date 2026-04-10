"use client";

import { useEffect, useRef, useState } from "react";
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
  Plus,
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

// ─── Collect all folder IDs that are ancestors of a note ─────────────────────

function collectAncestorFolderIds(
  data: BoxTreeData,
  noteId: string
): Set<string> {
  const note = data.notes.find((n) => n.id === noteId);
  if (!note?.folder_id) return new Set();

  const parentMap = new Map<string, string | null>();
  for (const f of data.folders) {
    parentMap.set(f.id, f.parent_folder_id);
  }

  const ancestors = new Set<string>();
  let current: string | null = note.folder_id;
  while (current) {
    ancestors.add(current);
    current = parentMap.get(current) ?? null;
  }
  return ancestors;
}

// ─── Note icon ────────────────────────────────────────────────────────────────

function noteIcon(kind: string) {
  if (kind === "guide") return BookOpen;
  if (kind === "bundle") return Package;
  return FileText;
}

// ─── Collapsible content wrapper ──────────────────────────────────────────────

/**
 * Animates open/close by measuring the natural height of the content
 * and transitioning max-height. This avoids layout thrash while still
 * giving a smooth collapse feel.
 */
function CollapsePanel({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(open ? undefined : 0);

  useEffect(() => {
    if (!ref.current) return;
    if (open) {
      // Measure then let it grow to auto
      const measured = ref.current.scrollHeight;
      setHeight(measured);
      const tid = setTimeout(() => setHeight(undefined), 150);
      return () => clearTimeout(tid);
    } else {
      // Snap to measured height first so CSS can animate down to 0
      const measured = ref.current.scrollHeight;
      setHeight(measured);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setHeight(0));
      });
    }
  }, [open]);

  return (
    <div
      ref={ref}
      style={{ maxHeight: height === undefined ? undefined : height }}
      className={cn(
        "overflow-hidden transition-all duration-150 ease-in-out",
        !open && "max-h-0"
      )}
      aria-hidden={!open}
    >
      {children}
    </div>
  );
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
  // depth 1 → pl-7, depth 2+ → pl-8 (further indented sub-items)
  const depthClass = depth <= 1 ? "pl-7" : "pl-8";
  return (
    <Link
      href={`/app/notes/${note.id}`}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2 rounded-md py-1 pr-2 text-xs",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        depthClass,
        isActive
          ? "bg-accent text-foreground font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
      )}
      aria-current={isActive ? "page" : undefined}
    >
      {/* noteIcon() returns a stable module-level icon reference — not a new component */}
      {/* eslint-disable-next-line react-hooks/static-components */}
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{note.title}</span>
    </Link>
  );
}

// ─── Folder node (collapsible) ────────────────────────────────────────────────

function FolderNode({
  folder,
  depth,
  currentNoteId,
  defaultOpen,
  onNavigate,
}: {
  folder: TreeFolderNode;
  depth: number;
  currentNoteId?: string;
  /** Whether this folder should be open by default (e.g., it's an ancestor of the active note) */
  defaultOpen?: boolean;
  onNavigate?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? false);
  const hasChildren = folder.children.length > 0 || folder.notes.length > 0;

  // depth 1 → pl-7 for sub-folder header, depth 2+ → pl-8
  const depthClass = depth <= 1 ? "pl-7" : "pl-8";

  return (
    <div>
      {/* Folder header row */}
      <div className={cn("group flex items-center gap-1 pr-1", depthClass)}>
        {/* Chevron toggle — always present for alignment; non-interactive if empty */}
        <button
          type="button"
          onClick={() => hasChildren && setIsOpen((o) => !o)}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded",
            "transition-colors duration-150",
            hasChildren
              ? "text-muted-foreground hover:bg-accent/50 hover:text-foreground cursor-pointer"
              : "text-muted-foreground/40 cursor-default",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          )}
          aria-label={isOpen ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
          aria-expanded={hasChildren ? isOpen : undefined}
          tabIndex={hasChildren ? 0 : -1}
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 transition-transform duration-150" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 transition-transform duration-150" aria-hidden="true" />
          )}
        </button>

        {/* Folder name */}
        <button
          type="button"
          onClick={() => hasChildren && setIsOpen((o) => !o)}
          className={cn(
            "flex flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-xs min-w-0",
            "transition-colors duration-150",
            hasChildren
              ? "text-foreground/60 hover:bg-accent/50 hover:text-foreground cursor-pointer"
              : "text-muted-foreground/40 cursor-default",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          )}
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
          <span className="truncate font-medium tracking-tight">{folder.name}</span>
        </button>
      </div>

      {/* Children — animated collapse/expand */}
      <CollapsePanel open={isOpen}>
        <div className="py-0.5">
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
      </CollapsePanel>
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
  const ancestorIds = currentNoteId ? collectAncestorFolderIds(data, currentNoteId) : new Set<string>();

  if (empty) {
    return (
      <p className="pl-7 py-1.5 text-xs text-muted-foreground/40 italic">
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
          defaultOpen={ancestorIds.has(folder.id)}
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
  return (
    <div>
      {/* Box header row */}
      <div className="group flex items-center gap-0.5 pr-1">
        {/* Chevron toggle */}
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded",
            "transition-colors duration-150",
            "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          )}
          aria-label={isExpanded ? `Collapse ${box.name}` : `Expand ${box.name}`}
          aria-expanded={isExpanded}
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 transition-transform duration-150" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 transition-transform duration-150" aria-hidden="true" />
          )}
        </button>

        {/* Box name link */}
        <Link
          href={`/app/boxes/${box.id}`}
          onClick={onNavigate}
          aria-current={isBoxActive ? "page" : undefined}
          className={cn(
            "flex flex-1 min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            isBoxActive
              ? "bg-accent text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          )}
        >
          <Box className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{box.name}</span>
        </Link>

        {/* Quick-create link — visible at low opacity, full opacity on hover/focus */}
        <Link
          href={`/app/boxes/${box.id}`}
          onClick={onNavigate}
          aria-label={`Open ${box.name} to create content`}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded",
            "opacity-30 transition-all duration-150",
            "group-hover:opacity-100",
            "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:opacity-100"
          )}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      {/* Expanded tree — animated */}
      <CollapsePanel open={isExpanded}>
        <div className="ml-3 py-0.5">
          {treeData ? (
            <BoxTree
              data={treeData}
              currentNoteId={currentNoteId}
              onNavigate={onNavigate}
            />
          ) : isLoading ? null : (
            <p className="pl-7 py-1.5 text-xs text-muted-foreground/40 italic">
              No content yet
            </p>
          )}
        </div>
      </CollapsePanel>
    </div>
  );
}

// ─── Tree sidebar ─────────────────────────────────────────────────────────────

export function TreeSidebar({
  boxes,
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
        <p className="px-2.5 py-2 text-xs text-muted-foreground/40">
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
