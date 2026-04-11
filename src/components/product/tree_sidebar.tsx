"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Bot,
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  FolderPlus,
  Link2,
  Package,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import {
  Folder01Icon,
  Folder02Icon,
  PackageIcon,
  PackageOpenIcon,
} from "hugeicons-react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/browser";
import { FileCreateDialog } from "@/components/product/file_create_dialog";
import { AgentCreateDialog } from "@/components/product/agent_create_dialog";
import { AttachReusableDialog } from "@/components/product/attach_reusable_dialog";
import {
  getBoxTreeAction,
  createNoteAction,
  createFolderAction,
  detachFromBoxAction,
} from "@/app/app/boxes/actions";
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
  folders: Array<{ id: string; name: string; parent_folder_id: string | null; status: string }>;
  notes: Array<{ id: string; title: string; kind: string; folder_id: string | null }>;
  files: Array<{ id: string; name: string; file_extension: string | null; folder_id: string | null }>;
  skills: Array<{ id: string; name: string; folder_id: string | null; status: string; is_reusable: boolean; is_attachment: boolean }>;
  agents: Array<{ id: string; name: string; folder_id: string | null; status: string; is_reusable: boolean; is_attachment: boolean }>;
};

type TreeNoteNode = {
  id: string;
  title: string;
  kind: string;
};

type TreeFileNode = {
  id: string;
  name: string;
  file_extension: string | null;
};

type TreeSkillNode = {
  id: string;
  name: string;
  status: string;
  is_reusable: boolean;
  is_attachment: boolean;
};

type TreeAgentNode = {
  id: string;
  name: string;
  status: string;
  is_reusable: boolean;
  is_attachment: boolean;
};

type TreeFolderNode = {
  id: string;
  name: string;
  children: TreeFolderNode[];
  notes: TreeNoteNode[];
  files: TreeFileNode[];
  skills: TreeSkillNode[];
  agents: TreeAgentNode[];
};

export interface TreeSidebarProps {
  boxes: Array<{ id: string; name: string; guide_note_id: string | null }>;
  workspaceName?: string;
  /** Workspace ID — used to scope Supabase Realtime subscriptions */
  workspaceId?: string;
  /** Current note ID extracted from URL, if on a note page */
  currentNoteId?: string;
  /** Current box ID extracted from URL, if on a box page */
  currentBoxId?: string;
  onNavigate?: () => void;
}

// ─── Build tree from flat data ────────────────────────────────────────────────

type BuiltTree = {
  rootFolders: TreeFolderNode[];
  rootNotes: TreeNoteNode[];
  rootFiles: TreeFileNode[];
  rootSkills: TreeSkillNode[];
  rootAgents: TreeAgentNode[];
};

function buildTree(data: BoxTreeData): BuiltTree {
  const folderMap = new Map<string, TreeFolderNode>();
  for (const f of data.folders) {
    folderMap.set(f.id, { id: f.id, name: f.name, children: [], notes: [], files: [], skills: [], agents: [] });
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

  const rootFiles: TreeFileNode[] = [];
  for (const f of (data.files ?? [])) {
    const item: TreeFileNode = { id: f.id, name: f.name, file_extension: f.file_extension };
    if (f.folder_id && folderMap.has(f.folder_id)) {
      folderMap.get(f.folder_id)!.files.push(item);
    } else {
      rootFiles.push(item);
    }
  }

  const rootSkills: TreeSkillNode[] = [];
  for (const s of (data.skills ?? [])) {
    const item: TreeSkillNode = { id: s.id, name: s.name, status: s.status, is_reusable: s.is_reusable, is_attachment: s.is_attachment };
    if (s.folder_id && folderMap.has(s.folder_id)) {
      folderMap.get(s.folder_id)!.skills.push(item);
    } else {
      rootSkills.push(item);
    }
  }

  const rootAgents: TreeAgentNode[] = [];
  for (const a of (data.agents ?? [])) {
    const item: TreeAgentNode = { id: a.id, name: a.name, status: a.status, is_reusable: a.is_reusable, is_attachment: a.is_attachment };
    if (a.folder_id && folderMap.has(a.folder_id)) {
      folderMap.get(a.folder_id)!.agents.push(item);
    } else {
      rootAgents.push(item);
    }
  }

  rootFolders.sort((a, b) => a.name.localeCompare(b.name));
  rootNotes.sort((a, b) => a.title.localeCompare(b.title));
  rootFiles.sort((a, b) => a.name.localeCompare(b.name));
  rootSkills.sort((a, b) => a.name.localeCompare(b.name));
  rootAgents.sort((a, b) => a.name.localeCompare(b.name));

  return { rootFolders, rootNotes, rootFiles, rootSkills, rootAgents };
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
      let raf2: number = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setHeight(0));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
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
      <span className="shrink-0 text-[10px] text-muted-foreground/40">.md</span>
    </Link>
  );
}

// ─── File row ─────────────────────────────────────────────────────────────────

function FileRow({
  file,
  depth,
  isActive,
  onNavigate,
}: {
  file: TreeFileNode;
  depth: number;
  isActive: boolean;
  onNavigate?: () => void;
}) {
  const depthClass = depth <= 1 ? "pl-7" : "pl-8";
  const ext = file.file_extension ? (file.file_extension.startsWith(".") ? file.file_extension : `.${file.file_extension}`) : null;
  return (
    <Link
      href={`/app/files/${file.id}`}
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
      <File className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{file.name}</span>
      {ext && <span className="shrink-0 text-[10px] text-muted-foreground/40">{ext}</span>}
    </Link>
  );
}

// ─── Skill row ────────────────────────────────────────────────────────────────

function SkillRow({
  skill,
  depth,
  boxId,
  isActive,
  onNavigate,
  onDetached,
}: {
  skill: TreeSkillNode;
  depth: number;
  /** Current box context — used to set ?box_id= on attached reusable links and for detach. */
  boxId?: string;
  isActive: boolean;
  onNavigate?: () => void;
  onDetached?: () => void;
}) {
  const [isPendingDetach, startDetach] = useTransition();
  const depthClass = depth <= 1 ? "pl-7" : "pl-8";
  const isArchived = skill.status === "archived";

  // Attached reusables link with box context so the page can show the reference banner
  const href = skill.is_attachment && boxId
    ? `/app/skills/${skill.id}?box_id=${boxId}`
    : `/app/skills/${skill.id}`;

  function handleDetach(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!boxId) return;
    startDetach(async () => {
      await detachFromBoxAction(boxId, "skill", skill.id);
      onDetached?.();
    });
  }

  return (
    <div className={cn("group/skill-row flex items-center gap-0 rounded-md", depthClass)}>
      <Link
        href={href}
        onClick={onNavigate}
        className={cn(
          "flex flex-1 items-center gap-2 rounded-md py-1 pr-1 text-xs min-w-0",
          "transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          isArchived && "opacity-50",
          isActive
            ? "bg-accent text-foreground font-medium"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
        )}
        aria-current={isActive ? "page" : undefined}
      >
        <Zap className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{skill.name}</span>
        {skill.is_attachment && (
          <span className="shrink-0 text-[10px] text-muted-foreground/30" title="Attached from workspace library">↗</span>
        )}
      </Link>
      {/* Detach button — only for attachments, shown on hover */}
      {skill.is_attachment && boxId && (
        <button
          type="button"
          onClick={handleDetach}
          disabled={isPendingDetach}
          title="Detach from this box"
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded",
            "opacity-0 group-hover/skill-row:opacity-100 transition-opacity duration-150",
            "text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100"
          )}
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ─── Agent row ────────────────────────────────────────────────────────────────

function AgentRow({
  agent,
  depth,
  boxId,
  isActive,
  onNavigate,
  onDetached,
}: {
  agent: TreeAgentNode;
  depth: number;
  /** Current box context — used to set ?box_id= on attached reusable links and for detach. */
  boxId?: string;
  isActive: boolean;
  onNavigate?: () => void;
  onDetached?: () => void;
}) {
  const [isPendingDetach, startDetach] = useTransition();
  const depthClass = depth <= 1 ? "pl-7" : "pl-8";
  const isArchived = agent.status === "archived";

  const href = agent.is_attachment && boxId
    ? `/app/agents/${agent.id}?box_id=${boxId}`
    : `/app/agents/${agent.id}`;

  function handleDetach(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!boxId) return;
    startDetach(async () => {
      await detachFromBoxAction(boxId, "agent", agent.id);
      onDetached?.();
    });
  }

  return (
    <div className={cn("group/agent-row flex items-center gap-0 rounded-md", depthClass)}>
      <Link
        href={href}
        onClick={onNavigate}
        className={cn(
          "flex flex-1 items-center gap-2 rounded-md py-1 pr-1 text-xs min-w-0",
          "transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          isArchived && "opacity-50",
          isActive
            ? "bg-accent text-foreground font-medium"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
        )}
        aria-current={isActive ? "page" : undefined}
      >
        <Bot className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{agent.name}</span>
        {agent.is_attachment && (
          <span className="shrink-0 text-[10px] text-muted-foreground/30" title="Attached from workspace library">↗</span>
        )}
      </Link>
      {/* Detach button — only for attachments, shown on hover */}
      {agent.is_attachment && boxId && (
        <button
          type="button"
          onClick={handleDetach}
          disabled={isPendingDetach}
          title="Detach from this box"
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded",
            "opacity-0 group-hover/agent-row:opacity-100 transition-opacity duration-150",
            "text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100"
          )}
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ─── Check if a folder (recursively) contains a given note ID ────────────────

function folderContainsNote(folder: TreeFolderNode, noteId: string): boolean {
  if (folder.notes.some((n) => n.id === noteId)) return true;
  return folder.children.some((child) => folderContainsNote(child, noteId));
}

// ─── Folder node (collapsible) ────────────────────────────────────────────────

function FolderNode({
  folder,
  depth,
  boxId,
  currentNoteId,
  defaultOpen,
  onNavigate,
  onTreeRefresh,
}: {
  folder: TreeFolderNode;
  depth: number;
  /** Box context — passed to SkillRow/AgentRow for ?box_id= links and detach. */
  boxId?: string;
  currentNoteId?: string;
  /** Whether this folder should be open by default (e.g., it's an ancestor of the active note) */
  defaultOpen?: boolean;
  onNavigate?: () => void;
  onTreeRefresh?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? false);
  const isEmpty =
    folder.children.length === 0 &&
    folder.notes.length === 0 &&
    folder.files.length === 0 &&
    folder.skills.length === 0 &&
    folder.agents.length === 0;

  // depth 1 → pl-7 for sub-folder header, depth 2+ → pl-8
  const depthClass = depth <= 1 ? "pl-7" : "pl-8";

  return (
    <div>
      {/* Folder header row */}
      <div className={cn("group flex items-center gap-1 pr-1", depthClass)}>
        {/* Chevron toggle */}
        <button
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded",
            "transition-colors duration-150",
            "text-muted-foreground hover:bg-accent/50 hover:text-foreground cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          )}
          aria-label={isOpen ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
          aria-expanded={isOpen}
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
          onClick={() => setIsOpen((o) => !o)}
          className={cn(
            "flex flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-xs min-w-0",
            "transition-colors duration-150",
            "text-foreground/60 hover:bg-accent/50 hover:text-foreground cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          )}
        >
          {isOpen
            ? <Folder02Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
            : <Folder01Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
          }
          <span className="truncate font-medium tracking-tight">{folder.name}</span>
        </button>
      </div>

      {/* Children — animated collapse/expand */}
      <CollapsePanel open={isOpen}>
        <div className="py-0.5">
          {isEmpty && (
            <p className="pl-8 py-1 text-[10px] text-muted-foreground/40 italic">
              Empty
            </p>
          )}
          {folder.notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              depth={depth + 1}
              isActive={note.id === currentNoteId}
              onNavigate={onNavigate}
            />
          ))}
          {folder.files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              depth={depth + 1}
              isActive={false}
              onNavigate={onNavigate}
            />
          ))}
          {folder.skills.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              depth={depth + 1}
              boxId={boxId}
              isActive={false}
              onNavigate={onNavigate}
              onDetached={onTreeRefresh}
            />
          ))}
          {folder.agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              depth={depth + 1}
              boxId={boxId}
              isActive={false}
              onNavigate={onNavigate}
              onDetached={onTreeRefresh}
            />
          ))}
          {folder.children.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              boxId={boxId}
              currentNoteId={currentNoteId}
              defaultOpen={currentNoteId ? folderContainsNote(child, currentNoteId) : false}
              onNavigate={onNavigate}
              onTreeRefresh={onTreeRefresh}
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
  boxId,
  currentNoteId,
  onNavigate,
  onTreeRefresh,
}: {
  data: BoxTreeData;
  boxId: string;
  currentNoteId?: string;
  onNavigate?: () => void;
  onTreeRefresh?: () => void;
}) {
  const { rootFolders, rootNotes, rootFiles, rootSkills, rootAgents } = buildTree(data);
  const empty =
    rootFolders.length === 0 &&
    rootNotes.length === 0 &&
    rootFiles.length === 0 &&
    rootSkills.length === 0 &&
    rootAgents.length === 0;
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
          boxId={boxId}
          currentNoteId={currentNoteId}
          defaultOpen={ancestorIds.has(folder.id)}
          onNavigate={onNavigate}
          onTreeRefresh={onTreeRefresh}
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
      {rootFiles.map((file) => (
        <FileRow
          key={file.id}
          file={file}
          depth={1}
          isActive={false}
          onNavigate={onNavigate}
        />
      ))}
      {rootSkills.map((skill) => (
        <SkillRow
          key={skill.id}
          skill={skill}
          depth={1}
          boxId={boxId}
          isActive={false}
          onNavigate={onNavigate}
          onDetached={onTreeRefresh}
        />
      ))}
      {rootAgents.map((agent) => (
        <AgentRow
          key={agent.id}
          agent={agent}
          depth={1}
          boxId={boxId}
          isActive={false}
          onNavigate={onNavigate}
          onDetached={onTreeRefresh}
        />
      ))}
    </div>
  );
}

// ─── Box quick-create menu ────────────────────────────────────────────────────

/**
 * Plus button attached to each BoxRow in the sidebar.
 * Opens a dropdown with two options (new note, new folder) each backed
 * by a minimal dialog — no folder list needed since both items land at root.
 */
function BoxQuickCreateMenu({
  box,
  onNavigate,
  onTreeRefresh,
}: {
  box: { id: string; name: string };
  onNavigate?: () => void;
  /** Called immediately after a note or folder is created so the tree refreshes without waiting for realtime */
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
        onTreeRefresh?.(); // Refresh tree immediately; realtime will also fire shortly after
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
        onTreeRefresh?.(); // Refresh tree immediately instead of full page refresh
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
          {/* File creation is handled by its own dialog via FileCreateDialog */}
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

      {/* File creation dialog — controlled from dropdown "New file" item */}
      <FileCreateDialog
        boxId={box.id}
        open={fileCreateOpen}
        onOpenChange={setFileCreateOpen}
        onCreated={() => { setFileCreateOpen(false); onTreeRefresh?.(); }}
      />

      {/* Agent creation dialog — controlled from dropdown "New agent" item */}
      <AgentCreateDialog
        boxId={box.id}
        open={agentCreateOpen}
        onOpenChange={setAgentCreateOpen}
        onCreated={() => { setAgentCreateOpen(false); onTreeRefresh?.(); }}
      />

      {/* Attach reusable dialog — browse workspace skills/agents and attach by reference */}
      <AttachReusableDialog
        boxId={box.id}
        open={attachOpen}
        onOpenChange={setAttachOpen}
        onAttached={() => { setAttachOpen(false); onTreeRefresh?.(); }}
      />
    </>
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
  onTreeRefresh,
}: {
  box: { id: string; name: string; guide_note_id: string | null };
  isExpanded: boolean;
  isBoxActive: boolean;
  isLoading: boolean;
  treeData: BoxTreeData | undefined;
  currentNoteId?: string;
  onToggle: () => void;
  onNavigate?: () => void;
  onTreeRefresh?: () => void;
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
            <Spinner size={14} aria-hidden="true" />
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
          {isExpanded
            ? <PackageOpenIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            : <PackageIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          }
          <span className="truncate">{box.name}</span>
        </Link>

        {/* Quick-create menu — note or folder, visible on hover */}
        <BoxQuickCreateMenu box={box} onNavigate={onNavigate} onTreeRefresh={onTreeRefresh} />
      </div>

      {/* Expanded tree — animated */}
      <CollapsePanel open={isExpanded}>
        <div className="ml-3 py-0.5">
          {treeData ? (
            <BoxTree
              data={treeData}
              boxId={box.id}
              currentNoteId={currentNoteId}
              onNavigate={onNavigate}
              onTreeRefresh={onTreeRefresh}
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
  workspaceId,
  currentNoteId,
  currentBoxId,
  onNavigate,
}: TreeSidebarProps) {
  const router = useRouter();
  const [expandedBoxIds, setExpandedBoxIds] = useState<Set<string>>(new Set());
  const [treeData, setTreeData] = useState<Map<string, BoxTreeData>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());

  // Refs for stable access inside realtime event handlers (avoids stale closures)
  const treeDataRef = useRef<Map<string, BoxTreeData>>(new Map());
  const boxIdsRef = useRef<Set<string>>(new Set(boxes.map((b) => b.id)));
  const realtimeDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Keep refs in sync with state/props
  useEffect(() => { treeDataRef.current = treeData; }, [treeData]);
  useEffect(() => { boxIdsRef.current = new Set(boxes.map((b) => b.id)); }, [boxes]);

  // Stable fetch function — state setters from useState are already stable
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

  // Debounced refetch — coalesces rapid realtime events (e.g. template applying multiple notes)
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

  // Supabase Realtime subscription — keeps the sidebar tree up to date without refresh
  useEffect(() => {
    if (!workspaceId) return;

    const supabase = createClient();

    const handleContentChange = (
      newRecord: Record<string, unknown>,
      oldRecord: Record<string, unknown>
    ) => {
      const boxId = (newRecord.box_id ?? oldRecord.box_id) as string | undefined;
      if (!boxId) return;
      // Only refresh if this box belongs to the workspace and its tree is loaded
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notes", filter: `workspace_id=eq.${workspaceId}` },
        makeHandler
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "folders", filter: `workspace_id=eq.${workspaceId}` },
        makeHandler
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "files", filter: `workspace_id=eq.${workspaceId}` },
        makeHandler
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "skills", filter: `workspace_id=eq.${workspaceId}` },
        makeHandler
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agents", filter: `workspace_id=eq.${workspaceId}` },
        makeHandler
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "boxes", filter: `workspace_id=eq.${workspaceId}` },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "box_object_attachments", filter: `workspace_id=eq.${workspaceId}` },
        makeHandler
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, scheduleTreeRefetch, router]);

  // Cleanup pending debounce timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of realtimeDebounceRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  // Auto-expand active box and refresh its tree data when currentBoxId changes
  useEffect(() => {
    const activeBoxId = currentBoxId;
    if (!activeBoxId) return;
    // Clear cached tree data so stale data is not shown after navigation
    setTreeData((prev) => {
      const next = new Map(prev);
      next.delete(activeBoxId);
      return next;
    });
    setExpandedBoxIds((prev) => {
      if (prev.has(activeBoxId)) return prev;
      return new Set([...prev, activeBoxId]);
    });
    // Fetch fresh tree data for the active box
    void fetchTree(activeBoxId);
  }, [currentBoxId, fetchTree]);

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
                onTreeRefresh={() => void fetchTree(box.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
