import { notFound } from "next/navigation";
import { Archive, Bot, ChevronRight, History, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getFileForWorkspace } from "@/server/services/file_service";
import { getBoxById } from "@/server/repositories/box_repository";
import { getFolderById } from "@/server/repositories/folder_repository";
import { getSkillById } from "@/server/repositories/skill_repository";
import { getAgentById } from "@/server/repositories/agent_repository";
import { getLinksForObject } from "@/server/services/object_link_service";
import { listObjectVersions } from "@/server/repositories/object_version_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import { listFilesByBox } from "@/server/repositories/file_repository";
import { OBJECT_TYPE } from "@/server/domain/constants/object_constants";
import { FileEditor } from "@/components/product/file_editor";
import { FileContextPanel } from "@/components/product/file_context_panel";
import { FileLanguageBadge } from "@/components/product/file_language_badge";
import { FileLifecycleMenu } from "@/components/product/file_lifecycle_menu";
import { FileImportButton } from "@/components/product/file_import_button";
import { Badge } from "@/components/ui/badge";
import { type SourceFormat } from "@/server/domain/constants/object_constants";
import { type ResolvedObjectLink, type LinkTarget } from "@/components/product/file_object_links_panel";
import { type ObjectLink } from "@/server/domain/types/object_link";
import { cn } from "@/lib/utils";
import { WorkspaceLiveRefresh } from "@/components/product/workspace_live_refresh";

// ─── Parent context types ─────────────────────────────────────────────────────

type ParentContext =
  | { kind: "box"; boxId: string; boxName: string; folderName: string | null }
  | { kind: "skill"; skillId: string; skillName: string; boxId: string | null; boxName: string | null }
  | { kind: "agent"; agentId: string; agentName: string; boxId: string | null; boxName: string | null };

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({
  workspaceName,
  parent,
  filename,
}: {
  workspaceName: string;
  parent: ParentContext;
  filename: string;
}) {
  const parts: Array<{ label: string; href: string | null; icon?: React.ReactNode }> = [
    { label: workspaceName, href: "/app" },
  ];

  if (parent.kind === "box") {
    parts.push({
      label: parent.boxName,
      href: `/app/boxes/${parent.boxId}`,
    });
    if (parent.folderName) {
      parts.push({ label: parent.folderName, href: null });
    }
  } else if (parent.kind === "skill") {
    if (parent.boxName && parent.boxId) {
      parts.push({ label: parent.boxName, href: `/app/boxes/${parent.boxId}` });
    } else {
      parts.push({ label: "Skills", href: "/app/skills" });
    }
    parts.push({
      label: parent.skillName,
      href: `/app/skills/${parent.skillId}?tab=children`,
      icon: <Zap className="h-3 w-3 shrink-0 text-yellow-600/70" aria-hidden="true" />,
    });
  } else if (parent.kind === "agent") {
    if (parent.boxName && parent.boxId) {
      parts.push({ label: parent.boxName, href: `/app/boxes/${parent.boxId}` });
    } else {
      parts.push({ label: "Agents", href: "/app/agents" });
    }
    parts.push({
      label: parent.agentName,
      href: `/app/agents/${parent.agentId}?tab=children`,
      icon: <Bot className="h-3 w-3 shrink-0 text-blue-600/70" aria-hidden="true" />,
    });
  }

  parts.push({ label: filename, href: null });

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
    >
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1;
        return (
          <span
            key={`${part.label}-${i}`}
            className={cn(
              "flex min-w-0 items-center gap-1",
              // Intermediate crumbs hide on very small screens so the
              // current file name always remains visible. The first
              // (workspace) and last (filename) crumbs are preserved
              // so the user never loses sense of place on mobile.
              !isLast && i > 0 && i < parts.length - 1 && "hidden sm:flex",
            )}
          >
            {i > 0 && (
              <ChevronRight
                className={cn(
                  "h-3 w-3 shrink-0",
                  i > 0 && i < parts.length - 1 && "hidden sm:inline-block",
                )}
                aria-hidden="true"
              />
            )}
            {part.icon}
            {part.href ? (
              <Link
                href={part.href}
                title={part.label}
                className="truncate max-w-[80px] sm:max-w-[140px] lg:max-w-[200px] hover:text-foreground hover:underline underline-offset-2 transition-fast"
              >
                {part.label}
              </Link>
            ) : isLast ? (
              <span
                className="truncate max-w-[140px] sm:max-w-[200px] lg:max-w-[260px] font-mono font-medium text-foreground/80"
                title={part.label}
              >
                {part.label}
              </span>
            ) : (
              <span
                className="truncate max-w-[80px] sm:max-w-[140px]"
                title={part.label}
              >
                {part.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// ─── Resolve object links to display info ─────────────────────────────────────

function resolveLink(
  link: ObjectLink,
  noteMap: Map<string, { id: string; title: string }>,
  fileMap: Map<string, { id: string; name: string; file_extension: string | null }>
): ResolvedObjectLink | null {
  const isOutgoing = link.source_object_type === OBJECT_TYPE.FILE;
  const linkedType = isOutgoing ? link.target_object_type : link.source_object_type;
  const linkedId = isOutgoing ? link.target_object_id : link.source_object_id;

  let linkedName = `Unknown ${linkedType}`;
  let linkedHref = "#";

  if (linkedType === OBJECT_TYPE.NOTE) {
    const note = noteMap.get(linkedId);
    if (note) {
      linkedName = note.title;
      linkedHref = `/app/notes/${linkedId}`;
    }
  } else if (linkedType === OBJECT_TYPE.FILE) {
    const file = fileMap.get(linkedId);
    if (file) {
      linkedName = file.name + (file.file_extension ?? "");
      linkedHref = `/app/files/${linkedId}`;
    }
  } else if (linkedType === OBJECT_TYPE.SKILL) {
    linkedName = `Skill: ${linkedId.slice(0, 8)}`;
    linkedHref = `/app/skills/${linkedId}`;
  } else if (linkedType === OBJECT_TYPE.AGENT) {
    linkedName = `Agent: ${linkedId.slice(0, 8)}`;
    linkedHref = `/app/agents/${linkedId}`;
  }

  return {
    id: link.id,
    relationship_type: link.relationship_type,
    relationship_note: link.relationship_note,
    linkedObjectType: linkedType,
    linkedObjectId: linkedId,
    linkedName,
    linkedHref,
  };
}

// ─── Valid tabs ───────────────────────────────────────────────────────────────

const VALID_TABS = ["info", "links", "history"] as const;
type FileContextTab = (typeof VALID_TABS)[number];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function FilePage({
  params,
  searchParams,
}: {
  params: Promise<{ file_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { file_id } = await params;
  const resolvedSearch = await searchParams;
  const rawTab = typeof resolvedSearch.tab === "string" ? resolvedSearch.tab : "info";
  const defaultTab: FileContextTab = VALID_TABS.includes(rawTab as FileContextTab)
    ? (rawTab as FileContextTab)
    : "info";

  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  // Load the file. getFileForWorkspace verifies ownership via workspace_id
  // directly — so this works for both box-local and workspace-level files.
  const file = await getFileForWorkspace(supabase, file_id, ctx.workspace.id);
  if (!file) notFound();

  // Resolve parent context. Precedence:
  //   1. parent_skill_id / parent_agent_id: file belongs to a Skill/Agent
  //      (either box-local or workspace-level reusable)
  //   2. box_id: file lives directly in a box (optionally in a folder)
  //   3. workspace-level file with no parent — unusual but legal
  let parent: ParentContext;
  let boxForListing: { id: string; name: string; workspace_id: string } | null = null;

  if (file.parent_skill_id) {
    const skill = await getSkillById(supabase, file.parent_skill_id);
    if (!skill || skill.workspace_id !== ctx.workspace.id) notFound();
    const skillBox = skill.box_id ? await getBoxById(supabase, skill.box_id) : null;
    if (skillBox) boxForListing = skillBox;
    parent = {
      kind: "skill",
      skillId: skill.id,
      skillName: skill.name,
      boxId: skill.box_id,
      boxName: skillBox?.name ?? null,
    };
  } else if (file.parent_agent_id) {
    const agent = await getAgentById(supabase, file.parent_agent_id);
    if (!agent || agent.workspace_id !== ctx.workspace.id) notFound();
    const agentBox = agent.box_id ? await getBoxById(supabase, agent.box_id) : null;
    if (agentBox) boxForListing = agentBox;
    parent = {
      kind: "agent",
      agentId: agent.id,
      agentName: agent.name,
      boxId: agent.box_id,
      boxName: agentBox?.name ?? null,
    };
  } else if (file.box_id) {
    const box = await getBoxById(supabase, file.box_id);
    if (!box || box.workspace_id !== ctx.workspace.id) notFound();
    boxForListing = box;
    const folder = file.folder_id
      ? await getFolderById(supabase, file.folder_id)
      : null;
    parent = {
      kind: "box",
      boxId: box.id,
      boxName: box.name,
      folderName: folder?.name ?? null,
    };
  } else {
    // Workspace-level file with no parent skill/agent — show a minimal box-less context.
    parent = {
      kind: "skill",
      skillId: "",
      skillName: "Workspace",
      boxId: null,
      boxName: null,
    };
  }

  // Fetch supporting data. Notes and sibling files come from the box when
  // one exists; workspace-level files skip box-scoped lookups gracefully.
  const [folder, rawLinks, versions, boxNotes, boxFiles] = await Promise.all([
    file.folder_id ? getFolderById(supabase, file.folder_id) : Promise.resolve(null),
    getLinksForObject(supabase, ctx.workspace.id, OBJECT_TYPE.FILE, file_id),
    listObjectVersions(supabase, "file", file_id, { limit: 50 }),
    boxForListing ? listNotesByBox(supabase, boxForListing.id) : Promise.resolve([]),
    boxForListing ? listFilesByBox(supabase, boxForListing.id) : Promise.resolve([]),
  ]);
  void folder;

  // Include the parent Skill/Agent's sibling child files as link targets.
  // Workspace-level files previously had an empty link pool because they
  // have no box context; siblings within the same package are the natural
  // target pool for cross-file references.
  let siblingFiles: Array<{
    id: string;
    name: string;
    file_extension: string | null;
  }> = [];
  if (parent.kind === "skill" && file.parent_skill_id) {
    const { data: skillSiblings } = await supabase
      .from("files")
      .select("id, name, file_extension")
      .eq("workspace_id", ctx.workspace.id)
      .eq("parent_skill_id", file.parent_skill_id)
      .neq("id", file_id)
      .neq("status", "trashed");
    siblingFiles = (skillSiblings ?? []) as typeof siblingFiles;
  } else if (parent.kind === "agent" && file.parent_agent_id) {
    const { data: agentSiblings } = await supabase
      .from("files")
      .select("id, name, file_extension")
      .eq("workspace_id", ctx.workspace.id)
      .eq("parent_agent_id", file.parent_agent_id)
      .neq("id", file_id)
      .neq("status", "trashed");
    siblingFiles = (agentSiblings ?? []) as typeof siblingFiles;
  }

  // Build resolution maps — include both the box-scoped files and
  // any sibling files owned by the same Skill/Agent.
  const noteMap = new Map(boxNotes.map((n) => [n.id, { id: n.id, title: n.title }]));
  const combinedFiles: Array<{
    id: string;
    name: string;
    file_extension: string | null;
  }> = [
    ...boxFiles.filter((f) => f.id !== file_id).map((f) => ({
      id: f.id,
      name: f.name,
      file_extension: f.file_extension,
    })),
    ...siblingFiles,
  ];
  // De-duplicate by id (a file could appear in both pools if it happens
  // to be both box-local and linked via a parent FK).
  const combinedFileMap = new Map<string, { id: string; name: string; file_extension: string | null }>();
  for (const f of combinedFiles) combinedFileMap.set(f.id, f);
  const fileMap = combinedFileMap;

  // Resolve links to display info
  const outgoingLinks: ResolvedObjectLink[] = rawLinks.outgoing
    .map((l) => resolveLink(l, noteMap, fileMap))
    .filter((l): l is ResolvedObjectLink => l !== null);
  const incomingLinks: ResolvedObjectLink[] = rawLinks.incoming
    .map((l) => resolveLink(l, noteMap, fileMap))
    .filter((l): l is ResolvedObjectLink => l !== null);

  // Build eligible link targets (notes + files in the same box, excluding self,
  // plus sibling child files inside the same parent Skill or Agent). This
  // gives workspace-level files a real link pool — the package's siblings —
  // instead of the empty pool they used to have.
  const eligibleFileEntries = new Map<
    string,
    { id: string; name: string; file_extension: string | null }
  >();
  for (const f of boxFiles) {
    if (f.id !== file_id) {
      eligibleFileEntries.set(f.id, {
        id: f.id,
        name: f.name,
        file_extension: f.file_extension,
      });
    }
  }
  for (const f of siblingFiles) {
    eligibleFileEntries.set(f.id, f);
  }
  const eligibleLinkTargets: LinkTarget[] = [
    ...boxNotes.map((n) => ({
      id: n.id,
      objectType: "note" as const,
      name: n.title,
      extension: ".md",
    })),
    ...Array.from(eligibleFileEntries.values())
      .map((f) => ({
        id: f.id,
        objectType: "file" as const,
        name: f.name,
        extension: f.file_extension,
      })),
  ];

  const ext = file.file_extension ?? "";
  const displayName = file.name + (ext.startsWith(".") ? ext : ext ? `.${ext}` : "");

  return (
    <div className="flex h-full overflow-hidden">
      <WorkspaceLiveRefresh
        workspaceId={ctx.workspace.id}
        scope="object"
        objectType="file"
        objectId={file_id}
        protectWhileEditing
      />
      {/* Center — file editor */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top bar: breadcrumb + format badge + actions */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 md:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <Breadcrumb
              workspaceName={ctx.workspace.name}
              parent={parent}
              filename={displayName}
            />
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* Status badge — only when non-active */}
            {file.status === "archived" && (
              <Badge
                variant="secondary"
                className="hidden sm:flex items-center gap-1 text-[10px] font-normal"
              >
                <Archive className="h-3 w-3" aria-hidden="true" />
                Archived
              </Badge>
            )}
            {file.status === "trashed" && (
              <Badge
                variant="secondary"
                className="hidden sm:flex items-center gap-1 text-[10px] font-normal text-destructive"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                Trash
              </Badge>
            )}

            {/* Import-into-file — replace or append from an uploaded file */}
            <FileImportButton fileId={file_id} />

            {/* History shortcut */}
            <Link
              href="?tab=history"
              aria-label="Version history"
              title="Version history"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-fast",
                "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">History</span>
            </Link>

            {/* Lifecycle menu */}
            <FileLifecycleMenu
              fileId={file_id}
              fileStatus={file.status as "draft" | "active" | "archived" | "trashed"}
            />
          </div>
        </div>

        {/* Mobile metadata strip */}
        {(file.status === "archived" || file.status === "trashed") && (
          <div className="flex items-center gap-2 border-b border-border px-6 py-1.5 lg:hidden">
            {file.status === "archived" && (
              <Badge variant="secondary" className="flex items-center gap-1 text-[10px] font-normal">
                <Archive className="h-2.5 w-2.5" aria-hidden="true" />
                Archived
              </Badge>
            )}
            {file.status === "trashed" && (
              <Badge variant="secondary" className="flex items-center gap-1 text-[10px] font-normal text-destructive">
                <Trash2 className="h-2.5 w-2.5" aria-hidden="true" />
                Trash
              </Badge>
            )}
            <FileLanguageBadge
              format={file.canonical_format as SourceFormat}
              extension={file.file_extension}
            />
          </div>
        )}

        {/* File editor — fills remaining space */}
        <div className="flex-1 overflow-hidden">
          <FileEditor file={file} />
        </div>
      </div>

      {/* Right panel — file context. Hidden on small screens; the file
          metadata is accessible via the History link or the lifecycle menu. */}
      <aside
        aria-label="File context panel"
        className="hidden lg:flex lg:h-full lg:w-72 lg:shrink-0 lg:flex-col lg:border-l lg:border-border lg:bg-background"
      >
        <FileContextPanel
          file={file}
          boxId={boxForListing?.id ?? ""}
          boxName={boxForListing?.name ?? (parent.kind === "skill" ? `Skill: ${parent.skillName}` : parent.kind === "agent" ? `Agent: ${parent.agentName}` : "")}
          folderName={parent.kind === "box" ? parent.folderName : null}
          workspaceName={ctx.workspace.name}
          outgoingLinks={outgoingLinks}
          incomingLinks={incomingLinks}
          eligibleLinkTargets={eligibleLinkTargets}
          versions={versions}
          defaultTab={defaultTab}
        />
      </aside>
    </div>
  );
}
