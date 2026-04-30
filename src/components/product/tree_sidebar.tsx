"use client";

import { useCallback, useEffect, useRef, useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  BookOpen,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  Package,
  PackageOpen,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { Tree, type NodeRendererProps, type NodeApi, type TreeApi } from "react-arborist";
import { getBoxColor, setBoxColor, BOX_COLOR_OPTIONS } from "@/lib/box_colors";
import { cn } from "@/lib/utils";
import { compareSiblings } from "@/server/domain/tree_ordering";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/browser";
import { FileCreateDialog } from "@/components/product/files/file_create_dialog";
import { AgentCreateDialog } from "@/components/product/agents/agent_create_dialog";
import { AttachReusableDialog } from "@/components/product/attach_reusable_dialog";
import {
  getBoxTreeAction,
  createNoteAction,
  createFolderAction,
  detachFromBoxAction,
  moveTreeNodeAction,
} from "@/app/app/boxes/actions";
import {
  renameNoteAction,
  renameFolderAction as treeRenameFolderAction,
  renameFileAction,
  renameSkillAction,
  renameAgentAction,
} from "@/app/app/boxes/tree_actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Types ────────────────────────────────────────────────────────────────────

type BoxTreeData = {
  folders: Array<{ id: string; name: string; parent_folder_id: string | null; status: string; sort_order: number }>;
  notes: Array<{ id: string; title: string; kind: string; folder_id: string | null; status: string; sort_order: number }>;
  files: Array<{ id: string; name: string; file_extension: string | null; folder_id: string | null; status: string; sort_order: number }>;
  skills: Array<{ id: string; name: string; folder_id: string | null; status: string; is_reusable: boolean; is_attachment: boolean; sort_order: number }>;
  agents: Array<{ id: string; name: string; folder_id: string | null; status: string; is_reusable: boolean; is_attachment: boolean; sort_order: number }>;
};

/** Unified node shape for react-arborist. */
export type TreeNodeData = {
  id: string;
  name: string;
  nodeType: "folder" | "note" | "file" | "skill" | "agent";
  objectId: string;
  children?: TreeNodeData[];
  kind?: string;
  fileExtension?: string | null;
  isReusable?: boolean;
  isAttachment?: boolean;
  status?: string;
  sortOrder: number;
};

export interface TreeSidebarProps {
  boxes: Array<{ id: string; name: string; guide_note_id: string | null }>;
  workspaceName?: string;
  workspaceId?: string;
  currentNoteId?: string;
  currentBoxId?: string;
  onNavigate?: () => void;
}

// ─── Build react-arborist tree from flat data ────────────────────────────────

function buildArboristTree(data: BoxTreeData): TreeNodeData[] {
  // Create folder nodes with children arrays
  const folderMap = new Map<string, TreeNodeData>();
  for (const f of data.folders) {
    folderMap.set(f.id, {
      id: `folder:${f.id}`,
      name: f.name,
      nodeType: "folder",
      objectId: f.id,
      children: [],
      status: f.status,
      sortOrder: f.sort_order,
    });
  }

  // Build folder hierarchy
  const rootNodes: TreeNodeData[] = [];
  for (const f of data.folders) {
    const node = folderMap.get(f.id)!;
    if (f.parent_folder_id && folderMap.has(f.parent_folder_id)) {
      folderMap.get(f.parent_folder_id)!.children!.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  // Helper to add leaf items to folder or root
  function addLeafItems<T extends { folder_id: string | null; sort_order: number }>(
    items: T[],
    makeNode: (item: T) => TreeNodeData
  ) {
    for (const item of items) {
      const node = makeNode(item);
      if (item.folder_id && folderMap.has(item.folder_id)) {
        folderMap.get(item.folder_id)!.children!.push(node);
      } else {
        rootNodes.push(node);
      }
    }
  }

  // Notes
  addLeafItems(data.notes, (n) => ({
    id: `note:${n.id}`,
    name: n.title,
    nodeType: "note",
    objectId: n.id,
    kind: n.kind,
    status: n.status,
    sortOrder: n.sort_order,
  }));

  // Files
  addLeafItems(data.files ?? [], (f) => ({
    id: `file:${f.id}`,
    name: f.name,
    nodeType: "file",
    objectId: f.id,
    fileExtension: (f as BoxTreeData["files"][0]).file_extension,
    status: f.status,
    sortOrder: f.sort_order,
  }));

  // Skills
  addLeafItems(data.skills ?? [], (s) => ({
    id: `skill:${s.id}`,
    name: s.name,
    nodeType: "skill",
    objectId: s.id,
    isReusable: (s as BoxTreeData["skills"][0]).is_reusable,
    isAttachment: (s as BoxTreeData["skills"][0]).is_attachment,
    status: s.status,
    sortOrder: s.sort_order,
  }));

  // Agents
  addLeafItems(data.agents ?? [], (a) => ({
    id: `agent:${a.id}`,
    name: a.name,
    nodeType: "agent",
    objectId: a.id,
    isReusable: (a as BoxTreeData["agents"][0]).is_reusable,
    isAttachment: (a as BoxTreeData["agents"][0]).is_attachment,
    status: a.status,
    sortOrder: a.sort_order,
  }));

  // Sort all children recursively using the shared tree-ordering
  // comparator so client render order matches the server move action's
  // sibling ordering. See src/server/domain/tree_ordering.ts.
  // Previously this used name.localeCompare as the tiebreaker, which
  // silently overrode structural sort_order whenever two siblings had
  // equal sort_order (very common before the registry backfill) — that
  // was one of the reasons drag reorder "didn't stick" on refresh.
  function sortChildren(nodes: TreeNodeData[]) {
    nodes.sort((a, b) =>
      compareSiblings(
        { objectType: a.nodeType, objectId: a.objectId, sortOrder: a.sortOrder },
        { objectType: b.nodeType, objectId: b.objectId, sortOrder: b.sortOrder }
      )
    );
    for (const node of nodes) {
      if (node.children) sortChildren(node.children);
    }
  }
  sortChildren(rootNodes);

  return rootNodes;
}

// ─── Find initial open state for ancestor folders of active note ─────────────

function computeOpenState(data: BoxTreeData, currentNoteId?: string): Record<string, boolean> {
  const openState: Record<string, boolean> = {};
  if (!currentNoteId) return openState;

  const note = data.notes.find((n) => n.id === currentNoteId);
  if (!note?.folder_id) return openState;

  const parentMap = new Map<string, string | null>();
  for (const f of data.folders) parentMap.set(f.id, f.parent_folder_id);

  let current: string | null = note.folder_id;
  while (current) {
    openState[`folder:${current}`] = true;
    current = parentMap.get(current) ?? null;
  }
  return openState;
}

// ─── Note icon helper ────────────────────────────────────────────────────────

function noteIcon(kind: string) {
  if (kind === "guide") return BookOpen;
  if (kind === "bundle") return Package;
  return FileText;
}

// ─── Count descendant notes (for collapsed folder badge) ─────────────────────

function countDescendantNotes(nodes: TreeNodeData[]): number {
  let count = 0;
  for (const n of nodes) {
    if (n.nodeType === "note") count++;
    if (n.children) count += countDescendantNotes(n.children);
  }
  return count;
}

// ─── Custom node renderer for react-arborist ─────────────────────────────────

function TreeNode({
  node,
  style,
  dragHandle,
  tree,
}: NodeRendererProps<TreeNodeData>) {
  const data = node.data;
  const pathname = usePathname();
  const router = useRouter();
  const [isPendingDetach, startDetach] = useTransition();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Determine active state
  const isActive = (() => {
    switch (data.nodeType) {
      case "note": return pathname === `/app/notes/${data.objectId}`;
      case "file": return pathname === `/app/files/${data.objectId}`;
      case "skill": return pathname === `/app/skills/${data.objectId}`;
      case "agent": return pathname === `/app/agents/${data.objectId}`;
      case "folder": return pathname === `/app/folders/${data.objectId}`;
      default: return false;
    }
  })();

  // Build href based on node type
  const href = (() => {
    switch (data.nodeType) {
      case "note": return `/app/notes/${data.objectId}`;
      case "file": return `/app/files/${data.objectId}`;
      case "skill": return `/app/skills/${data.objectId}`;
      case "agent": return `/app/agents/${data.objectId}`;
      case "folder": return `/app/folders/${data.objectId}`;
    }
  })();

  // Get the box ID and onNavigate from the tree context (stored in tree props)
  const boxId = (tree.props as { boxId?: string; onNavigate?: () => void }).boxId;
  const onNavigate = (tree.props as { boxId?: string; onNavigate?: () => void }).onNavigate;

  // For attached reusable items, append box context
  const finalHref = data.isAttachment && boxId && (data.nodeType === "skill" || data.nodeType === "agent")
    ? `${href}?box_id=${boxId}`
    : href;

  const isArchived = data.status === "archived";

  function handleDetach(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!boxId || !data.isAttachment) return;
    startDetach(async () => {
      await detachFromBoxAction(boxId, data.nodeType as "skill" | "agent", data.objectId);
    });
  }

  // File extension display
  const ext = data.nodeType === "file" && data.fileExtension
    ? (data.fileExtension.startsWith(".") ? data.fileExtension : `.${data.fileExtension}`)
    : data.nodeType === "note" ? ".md" : null;

  // Icon
  const Icon = (() => {
    switch (data.nodeType) {
      case "folder": return node.isOpen ? FolderOpen : Folder;
      case "note": return noteIcon(data.kind ?? "note");
      case "file": return File;
      case "skill": return Zap;
      case "agent": return Bot;
    }
  })();

  // Count all descendant notes recursively (for collapsed folder badge)
  function countDescendantNotes(nodes: TreeNodeData[]): number {
    let count = 0;
    for (const n of nodes) {
      if (n.nodeType === "note") count++;
      if (n.children) count += countDescendantNotes(n.children);
    }
    return count;
  }
  const folderNoteCount =
    data.nodeType === "folder" && !node.isOpen && data.children
      ? countDescendantNotes(data.children)
      : 0;

  return (
    <div
      style={style}
      ref={dragHandle}
      className={cn(
        "group/tree-node flex items-center gap-0 pr-1",
        isArchived && "opacity-50"
      )}
    >
      {/* Folder expand/collapse toggle — chevron rotates 90deg on open */}
      {data.nodeType === "folder" ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); node.toggle(); }}
          className={cn(
            "flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded",
            "text-muted-foreground transition-colors duration-150",
            "hover:bg-accent/60 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          )}
          aria-label={node.isOpen ? `Collapse ${data.name}` : `Expand ${data.name}`}
          aria-expanded={node.isOpen}
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-150",
              node.isOpen && "rotate-90"
            )}
            aria-hidden="true"
          />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}

      {/* Inline rename input — shown when react-arborist enters edit mode */}
      {node.isEditing ? (
        <form
          className="flex flex-1 min-w-0 items-center gap-1 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.querySelector("input");
            if (input) node.submit(input.value);
          }}
        >
          {/* eslint-disable-next-line react-hooks/static-components */}
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            defaultValue={data.name}
            autoFocus
            className={cn(
              "flex-1 min-w-0 rounded border border-ring bg-background px-1 py-0.5 text-xs text-foreground",
              "outline-none focus:ring-1 focus:ring-ring"
            )}
            onBlur={(e) => node.submit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.stopPropagation(); node.reset(); }
            }}
          />
        </form>
      ) : (
        /* Clickable link to object */
        <Link
          href={finalHref}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            // Double-click to rename (only for non-attachment items)
            if (!data.isAttachment) {
              e.preventDefault();
              e.stopPropagation();
              node.edit();
            }
          }}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-xs",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            isActive
              ? "bg-accent text-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          )}
          aria-current={isActive ? "page" : undefined}
        >
          {/* Icon is a stable module-level reference from lucide-react, not a new component */}
          {/* eslint-disable-next-line react-hooks/static-components */}
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{data.name}</span>
          {data.isAttachment && (
            <span className="shrink-0 text-[10px] text-muted-foreground/30" title="Attached from workspace library">↗</span>
          )}
          {ext && (
            <span className="shrink-0 text-[10px] text-muted-foreground/40">{ext}</span>
          )}
          {/* Folder note count badge — only shown when collapsed */}
          {folderNoteCount > 0 && (
            <span className="ml-auto text-[10px] text-muted-foreground/50">({folderNoteCount})</span>
          )}
        </Link>
      )}

      {/* Detach button for attached reusable items */}
      {data.isAttachment && boxId && !node.isEditing && (
        <button
          type="button"
          onClick={handleDetach}
          disabled={isPendingDetach}
          title="Detach from this box"
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded",
            "opacity-0 group-hover/tree-node:opacity-100 transition-opacity duration-150",
            "text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100"
          )}
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" />
        </button>
      )}

      {/* Context menu for note items — "Open in new tab" / "Copy link" */}
      {data.nodeType === "note" && !node.isEditing && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded",
              "opacity-0 group-hover/tree-node:opacity-100 transition-opacity duration-150",
              "text-muted-foreground/50 hover:bg-accent/50 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100"
            )}
            aria-label="Note options"
          >
            <span className="text-[10px] leading-none">···</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" sideOffset={4}>
            <DropdownMenuItem onClick={() => { router.push(finalHref); onNavigate?.(); }}>
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => window.open(finalHref, "_blank")}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Open in new tab
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                navigator.clipboard.writeText(
                  window.location.origin + finalHref
                )
              }
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Copy link
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ─── Box tree (react-arborist wrapper) ───────────────────────────────────────

function BoxTree({
  data,
  boxId,
  currentNoteId,
  filterText,
  treeRef,
  onNavigate,
  onTreeRefresh,
}: {
  data: BoxTreeData;
  boxId: string;
  currentNoteId?: string;
  filterText?: string;
  treeRef?: (api: TreeApi<TreeNodeData> | null | undefined) => void;
  onNavigate?: () => void;
  onTreeRefresh?: () => void;
}) {
  const [isMovePending, startMove] = useTransition();
  const [, startRename] = useTransition();

  const treeData = useMemo(() => buildArboristTree(data), [data]);
  const initialOpenState = useMemo(() => computeOpenState(data, currentNoteId), [data, currentNoteId]);

  const isEmpty = treeData.length === 0;
  if (isEmpty) {
    return (
      <p className="pl-7 py-1.5 text-xs text-muted-foreground/40 italic">
        No content yet
      </p>
    );
  }

  // Filter helper — returns true if a node or any of its descendants match
  function nodeMatchesFilter(node: TreeNodeData, text: string): boolean {
    if (node.name.toLowerCase().includes(text.toLowerCase())) return true;
    if (node.children) {
      return node.children.some((child) => nodeMatchesFilter(child, text));
    }
    return false;
  }

  // Build a filtered copy of the tree when filterText is non-empty
  function filterTree(nodes: TreeNodeData[], text: string): TreeNodeData[] {
    if (!text) return nodes;
    const result: TreeNodeData[] = [];
    for (const node of nodes) {
      if (node.name.toLowerCase().includes(text.toLowerCase())) {
        result.push(node);
      } else if (node.children) {
        const filteredChildren = filterTree(node.children, text);
        if (filteredChildren.length > 0) {
          result.push({ ...node, children: filteredChildren });
        }
      }
    }
    return result;
  }

  const displayData = filterText ? filterTree(treeData, filterText) : treeData;
  void nodeMatchesFilter; // used indirectly through filterTree

  // Handle drag-and-drop moves via react-arborist.
  //
  // react-arborist's args.index is the 0-based position in the destination
  // parent's visible sibling list after the drop completes. We forward it
  // verbatim as targetIndex so the server action can re-spread sort_order
  // across every sibling at that parent. Discarding this index — as earlier
  // revisions of this handler did — is what made sibling reordering never
  // persist.
  const handleMove = async (args: {
    dragIds: string[];
    dragNodes: NodeApi<TreeNodeData>[];
    parentId: string | null;
    parentNode: NodeApi<TreeNodeData> | null;
    index: number;
  }) => {
    if (isMovePending) return;

    const dragNode = args.dragNodes[0];
    if (!dragNode) return;

    const dragData = dragNode.data;

    // parentNode is null when dragging to the root, or a tree node for
    // drops into a folder. Only folders are valid containers — drops on
    // leaves are rejected by disableDrop, so we only care about folder vs
    // root here.
    const targetFolderId =
      args.parentNode && args.parentNode.data.nodeType === "folder"
        ? args.parentNode.data.objectId
        : null;

    startMove(async () => {
      await moveTreeNodeAction({
        boxId,
        draggedType: dragData.nodeType,
        draggedId: dragData.objectId,
        targetFolderId,
        targetIndex: args.index,
        isAttachment: dragData.isAttachment,
      });
      onTreeRefresh?.();
    });
  };

  // Handle inline rename via react-arborist
  const handleRename = (args: { id: string; name: string; node: NodeApi<TreeNodeData> }) => {
    const nodeData = args.node.data;
    const newName = args.name.trim();
    if (!newName || newName === nodeData.name) return;

    startRename(async () => {
      switch (nodeData.nodeType) {
        case "note":
          await renameNoteAction(nodeData.objectId, newName);
          break;
        case "folder":
          await treeRenameFolderAction(nodeData.objectId, newName);
          break;
        case "file":
          await renameFileAction(nodeData.objectId, newName);
          break;
        case "skill":
          await renameSkillAction(nodeData.objectId, newName);
          break;
        case "agent":
          await renameAgentAction(nodeData.objectId, newName);
          break;
      }
      onTreeRefresh?.();
    });
  };

  // Disable drop onto non-folder nodes (only folders and root can receive children)
  const disableDrop = (args: {
    parentNode: NodeApi<TreeNodeData> | null;
    dragNodes: NodeApi<TreeNodeData>[];
    index: number;
  }) => {
    const parent = args.parentNode;
    if (!parent || parent.isRoot) return false;
    // Only folders can receive children
    if (parent.data.nodeType !== "folder") return true;
    // Prevent dropping a folder into itself or its descendants
    const dragNode = args.dragNodes[0];
    if (dragNode && parent.data.nodeType === "folder" && dragNode.data.nodeType === "folder") {
      if (parent.isAncestorOf(dragNode) || parent.id === dragNode.id) return true;
    }
    return false;
  };

  // Calculate height based on initially visible nodes only.
  // Nodes in closed folders are not counted since they won't be visible.
  function countVisibleNodes(nodes: TreeNodeData[], openState: Record<string, boolean>): number {
    let count = nodes.length;
    for (const n of nodes) {
      if (n.children && openState[n.id]) {
        count += countVisibleNodes(n.children, openState);
      }
    }
    return count;
  }
  // When filtering, all matched nodes are visible; otherwise use initial open state
  const estimatedHeight = filterText
    ? Math.max(countAllNodes(displayData) * 28 + 20, 80)
    : Math.max(countVisibleNodes(treeData, initialOpenState) * 28 + 20, 80);

  function countAllNodes(nodes: TreeNodeData[]): number {
    let count = nodes.length;
    for (const n of nodes) {
      if (n.children) count += countAllNodes(n.children);
    }
    return count;
  }

  return (
    <Tree<TreeNodeData>
      ref={treeRef}
      data={displayData}
      onMove={handleMove}
      onRename={handleRename}
      disableDrop={disableDrop}
      disableEdit={(d) => !!d.isAttachment}
      disableMultiSelection={true}
      openByDefault={!!filterText}
      initialOpenState={filterText ? undefined : initialOpenState}
      rowHeight={28}
      indent={16}
      width="100%"
      height={estimatedHeight}
      className="arborist-tree"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...({ boxId, onNavigate } as any)}
    >
      {TreeNode}
    </Tree>
  );
}

// ─── Box quick-create menu ────────────────────────────────────────────────────

function BoxQuickCreateMenu({
  box,
  onNavigate,
  onTreeRefresh,
}: {
  box: { id: string; name: string };
  onNavigate?: () => void;
  onTreeRefresh?: () => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [fileCreateOpen, setFileCreateOpen] = useState(false);
  const [agentCreateOpen, setAgentCreateOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [folderName, setFolderName] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleCreateNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteTitle.trim()) return;
    setNoteError(null);
    startTransition(async () => {
      const result = await createNoteAction(box.id, noteTitle.trim());
      if (result.ok) {
        setNoteOpen(false);
        setNoteTitle("");
        onNavigate?.();
        onTreeRefresh?.();
        router.push(`/app/notes/${result.data.id}`);
      } else {
        setNoteError(result.error);
      }
    });
  }

  function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!folderName.trim()) return;
    setFolderError(null);
    startTransition(async () => {
      const result = await createFolderAction(box.id, folderName.trim());
      if (result.ok) {
        setFolderOpen(false);
        setFolderName("");
        onTreeRefresh?.();
      } else {
        setFolderError(result.error);
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded",
            "opacity-30 transition-all duration-150",
            "group-hover:opacity-100",
            "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:opacity-100"
          )}
          aria-label={`Create in ${box.name}`}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" sideOffset={4}>
          <DropdownMenuItem onClick={() => setNoteOpen(true)}>
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            New note
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setFolderOpen(true)}>
            <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
            New folder
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setFileCreateOpen(true)}>
            <File className="h-3.5 w-3.5" aria-hidden="true" />
            New file
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setAgentCreateOpen(true)}>
            <Bot className="h-3.5 w-3.5" aria-hidden="true" />
            New agent
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setAttachOpen(true)}>
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            Attach reusable…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Note creation dialog */}
      <Dialog open={noteOpen} onOpenChange={(v) => { setNoteOpen(v); if (!v) { setNoteTitle(""); setNoteError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New note in {box.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateNote} className="flex flex-col gap-3">
            <Input
              placeholder="Note title"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              autoFocus
              required
              disabled={isPending}
            />
            {noteError && (
              <p className="text-xs text-destructive" role="alert">{noteError}</p>
            )}
            <DialogFooter showCloseButton>
              <Button type="submit" size="sm" disabled={isPending || !noteTitle.trim()}>
                {isPending ? "Creating…" : "Create note"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Folder creation dialog */}
      <Dialog open={folderOpen} onOpenChange={(v) => { setFolderOpen(v); if (!v) { setFolderName(""); setFolderError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder in {box.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateFolder} className="flex flex-col gap-3">
            <Input
              placeholder="Folder name"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              autoFocus
              required
              disabled={isPending}
            />
            {folderError && (
              <p className="text-xs text-destructive" role="alert">{folderError}</p>
            )}
            <DialogFooter showCloseButton>
              <Button type="submit" size="sm" disabled={isPending || !folderName.trim()}>
                {isPending ? "Creating…" : "Create folder"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* File creation dialog */}
      <FileCreateDialog
        boxId={box.id}
        open={fileCreateOpen}
        onOpenChange={setFileCreateOpen}
        onCreated={() => { setFileCreateOpen(false); onTreeRefresh?.(); }}
      />

      {/* Agent creation dialog */}
      <AgentCreateDialog
        boxId={box.id}
        open={agentCreateOpen}
        onOpenChange={setAgentCreateOpen}
        onCreated={() => { setAgentCreateOpen(false); onTreeRefresh?.(); }}
      />

      {/* Attach reusable dialog */}
      <AttachReusableDialog
        boxId={box.id}
        open={attachOpen}
        onOpenChange={setAttachOpen}
        onAttached={() => { setAttachOpen(false); onTreeRefresh?.(); }}
      />
    </>
  );
}

// ─── Box row ─────────────────────────────────────────────────────────────────

function BoxRow({
  box,
  isExpanded,
  isBoxActive,
  isLoading,
  treeData,
  currentNoteId,
  filterText,
  onToggle,
  onNavigate,
  onTreeRefresh,
}: {
  box: { id: string; name: string; guide_note_id: string | null };
  isExpanded: boolean;
  isBoxActive: boolean;
  isLoading: boolean;
  treeData: BoxTreeData | undefined;
  currentNoteId?: string;
  filterText?: string;
  onToggle: () => void;
  onNavigate?: () => void;
  onTreeRefresh?: () => void;
}) {
  // Box color (Feature 5)
  const [color, setColor] = useState<string | null>(() => getBoxColor(box.id));
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  // Tree API ref for collapse/expand all (Feature 3)
  const treeApiRef = useRef<TreeApi<TreeNodeData> | undefined>(undefined);

  function handleColorPick(c: string | null) {
    setBoxColor(box.id, c);
    setColor(c);
    setColorPickerOpen(false);
  }

  return (
    <div>
      {/* Box header row */}
      <div className="group flex items-center gap-0.5 pr-1">
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
            <Spinner size={14} aria-hidden="true" />
          ) : isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 transition-transform duration-150" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 transition-transform duration-150" aria-hidden="true" />
          )}
        </button>

        {/* Color dot — right-click to open picker (Feature 5) */}
        <DropdownMenu open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
          <DropdownMenuTrigger
            className="shrink-0 flex items-center justify-center focus-visible:outline-none"
            aria-label="Set box color"
            title="Set box color"
          >
              {color ? (
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              ) : (
                <div className="w-2 h-2 rounded-full shrink-0 opacity-0 group-hover:opacity-30 bg-muted-foreground" />
              )}
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" sideOffset={4} className="p-2">
            <div className="flex flex-wrap gap-1.5 w-[120px] mb-1.5">
              {BOX_COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cn(
                    "w-4 h-4 rounded-full shrink-0 ring-offset-background transition-all",
                    "hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    color === c && "ring-2 ring-ring ring-offset-1"
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => handleColorPick(c)}
                  title={c}
                />
              ))}
            </div>
            {color && (
              <button
                type="button"
                className="w-full text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors text-left px-0.5"
                onClick={() => handleColorPick(null)}
              >
                None
              </button>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Link
          href={`/app/boxes/${box.id}`}
          onClick={onNavigate}
          aria-current={isBoxActive ? "page" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-sm",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            isBoxActive
              ? "bg-accent text-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          )}
        >
          {isExpanded
            ? <PackageOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
            : <Package className="h-4 w-4 shrink-0" aria-hidden="true" />
          }
          <span className="truncate">{box.name}</span>
        </Link>

        {/* Collapse all / Expand all buttons (Feature 3) — only visible when expanded */}
        {isExpanded && (
          <>
            <button
              type="button"
              onClick={() => treeApiRef.current?.closeAll?.()}
              title="Collapse all"
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded",
                "opacity-0 group-hover:opacity-100 transition-opacity duration-150",
                "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100"
              )}
            >
              <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => treeApiRef.current?.openAll?.()}
              title="Expand all"
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded",
                "opacity-0 group-hover:opacity-100 transition-opacity duration-150",
                "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100"
              )}
            >
              <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </>
        )}

        <BoxQuickCreateMenu box={box} onNavigate={onNavigate} onTreeRefresh={onTreeRefresh} />
      </div>

      {/* Expanded tree */}
      {isExpanded && (
        <div className="ml-3 py-0.5">
          {treeData ? (
            <BoxTree
              data={treeData}
              boxId={box.id}
              currentNoteId={currentNoteId}
              filterText={filterText}
              treeRef={(api) => { treeApiRef.current = api ?? undefined; }}
              onNavigate={onNavigate}
              onTreeRefresh={onTreeRefresh}
            />
          ) : isLoading ? null : (
            <p className="pl-7 py-1.5 text-xs text-muted-foreground/40 italic">
              No content yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tree sidebar ────────────────────────────────────────────────────────────

export function TreeSidebar({
  boxes,
  workspaceId,
  currentNoteId,
  currentBoxId,
  onNavigate,
}: TreeSidebarProps) {
  const router = useRouter();
  const [expandedBoxIds, setExpandedBoxIds] = useState<Set<string>>(new Set());
  const [treeData, setTreeData] = useState<Map<string, BoxTreeData>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");

  const treeDataRef = useRef<Map<string, BoxTreeData>>(new Map());
  const boxIdsRef = useRef<Set<string>>(new Set(boxes.map((b) => b.id)));
  const realtimeDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => { treeDataRef.current = treeData; }, [treeData]);
  useEffect(() => { boxIdsRef.current = new Set(boxes.map((b) => b.id)); }, [boxes]);

  const fetchTree = useCallback(async (boxId: string) => {
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
  }, []);

  const scheduleTreeRefetch = useCallback((boxId: string) => {
    const debounceMap = realtimeDebounceRef.current;
    const existing = debounceMap.get(boxId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      debounceMap.delete(boxId);
      void fetchTree(boxId);
    }, 300);
    debounceMap.set(boxId, timer);
  }, [fetchTree]);

  // Supabase Realtime subscription
  useEffect(() => {
    if (!workspaceId) return;
    const supabase = createClient();

    const handleContentChange = (
      newRecord: Record<string, unknown>,
      oldRecord: Record<string, unknown>
    ) => {
      const boxId = (newRecord.box_id ?? oldRecord.box_id) as string | undefined;
      if (!boxId) return;
      if (!boxIdsRef.current.has(boxId)) return;
      if (!treeDataRef.current.has(boxId)) return;
      scheduleTreeRefetch(boxId);
    };

    const makeHandler = (payload: { new: Record<string, unknown>; old: Record<string, unknown> }) =>
      handleContentChange(
        payload.new as Record<string, unknown>,
        payload.old as Record<string, unknown>
      );

    const channel = supabase
      .channel(`workspace-tree:${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: `workspace_id=eq.${workspaceId}` }, makeHandler)
      .on("postgres_changes", { event: "*", schema: "public", table: "folders", filter: `workspace_id=eq.${workspaceId}` }, makeHandler)
      .on("postgres_changes", { event: "*", schema: "public", table: "files", filter: `workspace_id=eq.${workspaceId}` }, makeHandler)
      .on("postgres_changes", { event: "*", schema: "public", table: "skills", filter: `workspace_id=eq.${workspaceId}` }, makeHandler)
      .on("postgres_changes", { event: "*", schema: "public", table: "agents", filter: `workspace_id=eq.${workspaceId}` }, makeHandler)
      .on("postgres_changes", { event: "*", schema: "public", table: "boxes", filter: `workspace_id=eq.${workspaceId}` }, () => {
        // Throttle box-level refreshes (name/status changes update sidebar labels)
        const debounceMap = realtimeDebounceRef.current;
        const existing = debounceMap.get("__boxes__");
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          debounceMap.delete("__boxes__");
          router.refresh();
        }, 500);
        debounceMap.set("__boxes__", timer);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "box_object_attachments", filter: `workspace_id=eq.${workspaceId}` }, makeHandler)
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [workspaceId, scheduleTreeRefetch, router]);

  useEffect(() => {
    return () => {
      for (const timer of realtimeDebounceRef.current.values()) clearTimeout(timer);
    };
  }, []);

  // Auto-expand active box
  useEffect(() => {
    const activeBoxId = currentBoxId;
    if (!activeBoxId) return;
    setTreeData((prev) => {
      const next = new Map(prev);
      next.delete(activeBoxId);
      return next;
    });
    setExpandedBoxIds((prev) => {
      if (prev.has(activeBoxId)) return prev;
      return new Set([...prev, activeBoxId]);
    });
    void fetchTree(activeBoxId);
  }, [currentBoxId, fetchTree]);

  function toggleBox(boxId: string) {
    const willExpand = !expandedBoxIds.has(boxId);
    setExpandedBoxIds((prev) => {
      const next = new Set(prev);
      if (next.has(boxId)) next.delete(boxId);
      else next.add(boxId);
      return next;
    });
    if (willExpand && !treeData.has(boxId) && !loading.has(boxId)) {
      void fetchTree(boxId);
    }
  }

  return (
    <nav aria-label="Boxes" className="flex flex-col gap-0.5 px-1">
      {boxes.length === 0 ? (
        <p className="px-2.5 py-2 text-xs text-muted-foreground/40">
          No boxes yet
        </p>
      ) : (
        <>
          {/* Filter input (Feature 1) */}
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter..."
            className="w-full rounded-md border border-border/50 bg-muted/30 px-2 py-1 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-border mb-1"
          />
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
                  filterText={filterText}
                  onToggle={() => toggleBox(box.id)}
                  onNavigate={onNavigate}
                  onTreeRefresh={() => void fetchTree(box.id)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  );
}
