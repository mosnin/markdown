import { notFound } from "next/navigation";
import { Archive, ChevronRight, History, Trash2 } from "lucide-react";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getFileForWorkspace } from "@/server/services/file_service";
import { getBoxById } from "@/server/repositories/box_repository";
import { getFolderById } from "@/server/repositories/folder_repository";
import { getLinksForObject } from "@/server/services/object_link_service";
import { listObjectVersions } from "@/server/repositories/object_version_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import { listFilesByBox } from "@/server/repositories/file_repository";
import { OBJECT_TYPE } from "@/server/domain/constants/object_constants";
import { FileEditor } from "@/components/product/file_editor";
import { FileContextPanel } from "@/components/product/file_context_panel";
import { FileLanguageBadge } from "@/components/product/file_language_badge";
import { FileLifecycleMenu } from "@/components/product/file_lifecycle_menu";
import { Badge } from "@/components/ui/badge";
import { type SourceFormat } from "@/server/domain/constants/object_constants";
import { type ResolvedObjectLink, type LinkTarget } from "@/components/product/file_object_links_panel";
import { type ObjectLink } from "@/server/domain/types/object_link";
import { cn } from "@/lib/utils";

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({
  workspaceName,
  boxId,
  boxName,
  folderName,
  filename,
}: {
  workspaceName: string;
  boxId: string;
  boxName: string;
  folderName: string | null;
  filename: string;
}) {
  const parts = [
    { label: workspaceName, href: "/app" },
    { label: boxName, href: `/app/boxes/${boxId}` },
    ...(folderName ? [{ label: folderName, href: null as string | null }] : []),
    { label: filename, href: null as string | null },
  ];

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
      {parts.map((part, i) => (
        <span key={`${part.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && (
            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          )}
          {part.href ? (
            <Link
              href={part.href}
              className="hover:text-foreground hover:underline underline-offset-2 transition-fast"
            >
              {part.label}
            </Link>
          ) : i === parts.length - 1 ? (
            <span
              className="max-w-[180px] truncate font-mono font-medium text-foreground/80"
              title={part.label}
            >
              {part.label}
            </span>
          ) : (
            <span>{part.label}</span>
          )}
        </span>
      ))}
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

  const file = await getFileForWorkspace(supabase, file_id, ctx.workspace.id);
  if (!file) notFound();

  const box = file.box_id ? await getBoxById(supabase, file.box_id) : null;
  if (!box || box.workspace_id !== ctx.workspace.id) notFound();

  const [folder, rawLinks, versions, boxNotes, boxFiles] = await Promise.all([
    file.folder_id ? getFolderById(supabase, file.folder_id) : Promise.resolve(null),
    getLinksForObject(supabase, ctx.workspace.id, OBJECT_TYPE.FILE, file_id),
    listObjectVersions(supabase, "file", file_id, { limit: 50 }),
    listNotesByBox(supabase, box.id),
    listFilesByBox(supabase, box.id),
  ]);

  // Build resolution maps
  const noteMap = new Map(boxNotes.map((n) => [n.id, { id: n.id, title: n.title }]));
  const fileMap = new Map(
    boxFiles
      .filter((f) => f.id !== file_id)
      .map((f) => [f.id, { id: f.id, name: f.name, file_extension: f.file_extension }])
  );

  // Resolve links to display info
  const outgoingLinks: ResolvedObjectLink[] = rawLinks.outgoing
    .map((l) => resolveLink(l, noteMap, fileMap))
    .filter((l): l is ResolvedObjectLink => l !== null);
  const incomingLinks: ResolvedObjectLink[] = rawLinks.incoming
    .map((l) => resolveLink(l, noteMap, fileMap))
    .filter((l): l is ResolvedObjectLink => l !== null);

  // Build eligible link targets (notes + files in the same box, excluding self)
  const eligibleLinkTargets: LinkTarget[] = [
    ...boxNotes.map((n) => ({
      id: n.id,
      objectType: "note" as const,
      name: n.title,
      extension: ".md",
    })),
    ...boxFiles
      .filter((f) => f.id !== file_id)
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
      {/* Center — file editor */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top bar: breadcrumb + format badge + actions */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <Breadcrumb
              workspaceName={ctx.workspace.name}
              boxId={box.id}
              boxName={box.name}
              folderName={folder?.name ?? null}
              filename={displayName}
            />
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* Status badge — only when non-active */}
            {file.status === "archived" && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1 text-[10px] font-normal"
              >
                <Archive className="h-3 w-3" aria-hidden="true" />
                Archived
              </Badge>
            )}
            {file.status === "trashed" && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1 text-[10px] font-normal text-destructive"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                Trash
              </Badge>
            )}

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

      {/* Right panel — file context */}
      <aside
        aria-label="File context panel"
        className="hidden lg:flex lg:h-full lg:w-72 lg:shrink-0 lg:flex-col lg:border-l lg:border-border lg:bg-background"
      >
        <FileContextPanel
          file={file}
          boxId={box.id}
          boxName={box.name}
          folderName={folder?.name ?? null}
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
