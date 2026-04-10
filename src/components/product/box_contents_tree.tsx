import React from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, FileText, Folder, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Folder as FolderType } from "@/server/domain/types/folder";
import { type Note } from "@/server/domain/types/note";

// ─── Tree data types ──────────────────────────────────────────────────────────

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

// ─── Build tree from flat lists ───────────────────────────────────────────────

export function buildBoxTree(
  folders: FolderType[],
  notes: Note[]
): { rootFolders: TreeFolder[]; rootNotes: TreeNote[] } {
  // Map folder id → TreeFolder
  const folderMap = new Map<string, TreeFolder>();
  for (const f of folders) {
    folderMap.set(f.id, {
      id: f.id,
      name: f.name,
      slug: f.slug,
      path_cache: f.path_cache,
      status: f.status,
      children: [],
      notes: [],
    });
  }

  const rootFolders: TreeFolder[] = [];

  // Link children to parents
  for (const f of folders) {
    const node = folderMap.get(f.id)!;
    if (f.parent_folder_id && folderMap.has(f.parent_folder_id)) {
      folderMap.get(f.parent_folder_id)!.children.push(node);
    } else {
      rootFolders.push(node);
    }
  }

  // Attach notes to their folder or to root
  const rootNotes: TreeNote[] = [];
  for (const note of notes) {
    const item: TreeNote = {
      id: note.id,
      title: note.title,
      kind: note.kind as "note" | "guide" | "bundle",
      slug: note.slug,
    };
    if (note.folder_id && folderMap.has(note.folder_id)) {
      folderMap.get(note.folder_id)!.notes.push(item);
    } else {
      rootNotes.push(item);
    }
  }

  // Sort
  rootFolders.sort((a, b) => a.name.localeCompare(b.name));
  rootNotes.sort((a, b) => a.title.localeCompare(b.title));

  return { rootFolders, rootNotes };
}

// ─── Note icons ───────────────────────────────────────────────────────────────

const kindIcon = {
  note: FileText,
  guide: BookOpen,
  bundle: Package,
} as const;

// ─── Tree node components ─────────────────────────────────────────────────────

function NoteRow({ note, depth = 0 }: { note: TreeNote; depth?: number }) {
  const Icon = kindIcon[note.kind];
  return (
    <Link
      href={`/app/notes/${note.id}`}
      className={cn(
        "flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm",
        "text-foreground/70 transition-fast hover:bg-accent hover:text-foreground"
      )}
      style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
    >
      <span className="h-3 w-3 shrink-0" /> {/* align with folder chevron */}
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{note.title}</span>
    </Link>
  );
}

function FolderNode({
  folder,
  depth = 0,
  folderLifecycleMenu,
}: {
  folder: TreeFolder;
  depth?: number;
  folderLifecycleMenu?: (folder: TreeFolder) => React.ReactNode;
}) {
  const hasChildren = folder.children.length > 0 || folder.notes.length > 0;
  return (
    <div>
      <div
        className="flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm text-foreground/70"
        style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
      >
        {hasChildren ? (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <span className="h-3 w-3 shrink-0" />
        )}
        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium flex-1">{folder.name}</span>
        {folderLifecycleMenu?.(folder)}
      </div>
      {folder.notes.map((note) => (
        <NoteRow key={note.id} note={note} depth={depth + 1} />
      ))}
      {folder.children.map((child) => (
        <FolderNode key={child.id} folder={child} depth={depth + 1} folderLifecycleMenu={folderLifecycleMenu} />
      ))}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

interface BoxContentsTreeProps {
  folders: FolderType[];
  notes: Note[];
  className?: string;
  /** Optional render prop — renders a lifecycle menu next to each folder row. */
  folderLifecycleMenu?: (folder: TreeFolder) => React.ReactNode;
}

/**
 * Hierarchical tree of folders and notes for a box.
 * Server component — renders links, no expand/collapse state needed in V1.
 */
export function BoxContentsTree({ folders, notes, className, folderLifecycleMenu }: BoxContentsTreeProps) {
  const { rootFolders, rootNotes } = buildBoxTree(folders, notes);

  const empty = rootFolders.length === 0 && rootNotes.length === 0;
  if (empty) {
    return (
      <p className={cn("px-4 py-3 text-sm text-muted-foreground", className)}>
        No content yet. Use New folder or New note above, or Import to bring in existing Markdown files.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {rootFolders.map((folder) => (
        <FolderNode key={folder.id} folder={folder} folderLifecycleMenu={folderLifecycleMenu} />
      ))}
      {rootNotes.map((note) => (
        <NoteRow key={note.id} note={note} />
      ))}
    </div>
  );
}
