"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Bot,
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Folder,
  Package,
  Zap,
} from "lucide-react";
import { Tree, type NodeRendererProps } from "react-arborist";
import { cn } from "@/lib/utils";
import { type Folder as FolderType } from "@/server/domain/types/folder";
import { type Note } from "@/server/domain/types/note";

// ─── Tree data types ─────────────────────────────────────────────────────────

export interface TreeNote {
  id: string;
  title: string;
  kind: "note" | "guide" | "bundle";
  slug: string;
}

export interface TreeFolder {
  id: string;
  name: string;
  slug: string;
  path_cache: string;
  status: string;
  children: TreeFolder[];
  notes: TreeNote[];
}

// ─── Arborist node type ──────────────────────────────────────────────────────

type ContentsTreeNode = {
  id: string;
  name: string;
  nodeType: "folder" | "note";
  objectId: string;
  kind?: string;
  pathCache?: string;
  status?: string;
  children?: ContentsTreeNode[];
};

// ─── Build arborist tree from flat lists ─────────────────────────────────────

function buildContentsTree(folders: FolderType[], notes: Note[]): ContentsTreeNode[] {
  const folderMap = new Map<string, ContentsTreeNode>();
  for (const f of folders) {
    folderMap.set(f.id, {
      id: `folder:${f.id}`,
      name: f.name,
      nodeType: "folder",
      objectId: f.id,
      pathCache: f.path_cache,
      status: f.status,
      children: [],
    });
  }

  const rootNodes: ContentsTreeNode[] = [];
  for (const f of folders) {
    const node = folderMap.get(f.id)!;
    if (f.parent_folder_id && folderMap.has(f.parent_folder_id)) {
      folderMap.get(f.parent_folder_id)!.children!.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  for (const n of notes) {
    const node: ContentsTreeNode = {
      id: `note:${n.id}`,
      name: n.title,
      nodeType: "note",
      objectId: n.id,
      kind: n.kind,
    };
    if (n.folder_id && folderMap.has(n.folder_id)) {
      folderMap.get(n.folder_id)!.children!.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  // Sort: folders first, then alphabetically
  function sortChildren(nodes: ContentsTreeNode[]) {
    nodes.sort((a, b) => {
      const aFolder = a.nodeType === "folder" ? 0 : 1;
      const bFolder = b.nodeType === "folder" ? 0 : 1;
      if (aFolder !== bFolder) return aFolder - bFolder;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children) sortChildren(n.children);
    }
  }
  sortChildren(rootNodes);

  return rootNodes;
}

// ─── Note icon ───────────────────────────────────────────────────────────────

const kindIcon = {
  note: FileText,
  guide: BookOpen,
  bundle: Package,
} as const;

// ─── Custom node renderer ────────────────────────────────────────────────────

function ContentsNode({
  node,
  style,
  dragHandle,
}: NodeRendererProps<ContentsTreeNode>) {
  const data = node.data;
  const pathname = usePathname();

  const href = data.nodeType === "folder"
    ? `/app/folders/${data.objectId}`
    : `/app/notes/${data.objectId}`;

  const isActive = pathname === href;

  const Icon = data.nodeType === "folder"
    ? Folder
    : kindIcon[(data.kind as keyof typeof kindIcon) ?? "note"] ?? FileText;

  return (
    <div style={style} ref={dragHandle} className="flex items-center gap-0">
      {data.nodeType === "folder" ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); node.toggle(); }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          aria-expanded={node.isOpen}
        >
          {node.isOpen ? (
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          )}
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}

      <Link
        href={href}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex flex-1 min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-sm",
          "transition-fast hover:bg-accent hover:text-foreground",
          isActive
            ? "bg-accent text-foreground font-medium"
            : "text-foreground/70",
          data.nodeType === "folder" && "font-medium"
        )}
        aria-current={isActive ? "page" : undefined}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{data.name}</span>
      </Link>
    </div>
  );
}

// ─── Public component ────────────────────────────────────────────────────────

interface BoxContentsTreeProps {
  folders: FolderType[];
  notes: Note[];
  className?: string;
  folderLifecycleMenu?: (folder: TreeFolder) => React.ReactNode;
  folderActions?: (folder: TreeFolder) => React.ReactNode;
}

export function BoxContentsTree({
  folders,
  notes,
  className,
}: BoxContentsTreeProps) {
  const treeData = useMemo(() => buildContentsTree(folders, notes), [folders, notes]);

  if (treeData.length === 0) {
    return (
      <p className={cn("px-4 py-3 text-sm text-muted-foreground", className)}>
        No content yet. Use New folder or New note above, or Import to bring in existing Markdown files.
      </p>
    );
  }

  const estimatedHeight = Math.min((folders.length + notes.length) * 32 + 20, 800);

  return (
    <div className={cn("flex flex-col", className)}>
      <Tree<ContentsTreeNode>
        data={treeData}
        openByDefault={true}
        disableDrag={true}
        disableDrop={true}
        disableEdit={true}
        disableMultiSelection={true}
        rowHeight={32}
        indent={20}
        width="100%"
        height={estimatedHeight}
        className="arborist-contents-tree"
      >
        {ContentsNode}
      </Tree>
    </div>
  );
}

// Re-export for backwards compatibility
export { buildContentsTree as buildBoxTree };
