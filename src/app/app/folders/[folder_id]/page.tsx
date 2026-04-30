import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Archive,
  Bot,
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  Zap,
} from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import {
  getFolderById,
  listFoldersByBox,
  listFoldersByParent,
} from "@/server/repositories/folder_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import { listFilesByBox } from "@/server/repositories/file_repository";
import { listSkillsByBox } from "@/server/repositories/skill_repository";
import { listAgentsByBox } from "@/server/repositories/agent_repository";
import { CreateFolderDialog } from "@/components/product/create/create_folder_dialog";
import { FileCreateDialog } from "@/components/product/files/file_create_dialog";
import { SkillCreateDialog } from "@/components/product/skills/skill_create_dialog";
import { AgentCreateDialog } from "@/components/product/agents/agent_create_dialog";
import { FolderWorkspaceActions } from "@/components/product/folders/folder_workspace_actions";
import { FolderLifecycleMenu } from "@/components/product/folders/folder_lifecycle_menu";
import { FolderPolicyToggle } from "@/components/product/folders/folder_policy_toggle";
import { FolderExportButton } from "@/components/product/folders/folder_export_button";
import { WorkspaceLiveRefresh } from "@/components/product/workspace/workspace_live_refresh";
import { ActiveBranchBannerServer } from "@/components/product/active_branch_banner_server";
import { PageHeader } from "@/components/product/page_header";
import { formatAbsoluteDate } from "@/lib/format_date";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export default async function FolderPage({
  params,
}: {
  params: Promise<{ folder_id: string }>;
}) {
  const { folder_id } = await params;
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const branchId = ctx.activeBranchId ?? null;
  const folder = await getFolderById(supabase, folder_id, { branchId });
  if (!folder) notFound();

  // Verify ownership: via box for box-level folders, via workspace_id for workspace-level
  let box: Awaited<ReturnType<typeof getBoxById>> = null;
  if (folder.box_id) {
    box = await getBoxById(supabase, folder.box_id);
    if (!box || box.workspace_id !== ctx.workspace.id) notFound();
  } else if (folder.workspace_id !== ctx.workspace.id) {
    notFound();
  }

  // Fetch all child content via the repository readers so branch
  // filters + pending-op overlays + folder_branch_overrides all apply
  // uniformly. Note/File/Skill/Agent readers accept folder_id directly;
  // listFoldersByParent replaces the inline child-folder query and
  // carries the branch filter the same way.
  const [childFolders, childNotes, childFiles, childSkills, childAgents] = await Promise.all([
    listFoldersByParent(supabase, folder.id, { branchId }),
    folder.box_id
      ? listNotesByBox(supabase, folder.box_id, {
          folder_id: folder.id,
          branchId,
        })
      : Promise.resolve([]),
    folder.box_id
      ? listFilesByBox(supabase, folder.box_id, {
          folder_id: folder.id,
          branchId,
        })
      : Promise.resolve([]),
    folder.box_id
      ? listSkillsByBox(supabase, folder.box_id, {
          folder_id: folder.id,
          branchId,
        })
      : Promise.resolve([]),
    folder.box_id
      ? listAgentsByBox(supabase, folder.box_id, {
          folder_id: folder.id,
          branchId,
        })
      : Promise.resolve([]),
  ]);

  // Build breadcrumb path — `getFolderById` with a branchId applies
  // the folder_branch_overrides overlay so renamed folders on the
  // active branch appear with their branch-local name here.
  const breadcrumbs: Array<{ id: string; name: string }> = [];
  if (folder.parent_folder_id) {
    let parentId: string | null = folder.parent_folder_id;
    while (parentId) {
      const parent = await getFolderById(supabase, parentId, { branchId });
      if (!parent) break;
      breadcrumbs.unshift({ id: parent.id, name: parent.name });
      parentId = parent.parent_folder_id;
    }
  }

  const isArchived = folder.status === "archived";
  const totalChildren = childFolders.length + childNotes.length + childFiles.length + childSkills.length + childAgents.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ActiveBranchBannerServer />
      <div className="flex flex-1 overflow-hidden">
      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <WorkspaceLiveRefresh
          workspaceId={ctx.workspace.id}
          scope="folder"
          boxId={box?.id ?? null}
          folderId={folder.id}
        />

        <PageHeader
          eyebrow={
            breadcrumbs.length > 0
              ? breadcrumbs[breadcrumbs.length - 1].name
              : (box?.name ?? "Workspace")
          }
          eyebrowHref={
            breadcrumbs.length > 0
              ? `/app/folders/${breadcrumbs[breadcrumbs.length - 1].id}`
              : box
                ? `/app/boxes/${box.id}`
                : "/app/workspaces"
          }
          title={folder.name}
          description={folder.description ?? undefined}
          meta={
            isArchived ? (
              <Badge variant="secondary" className="text-[10px] font-normal">
                <Archive className="mr-1 h-3 w-3" aria-hidden="true" />
                Archived
              </Badge>
            ) : undefined
          }
          actions={
            <>
              <FolderExportButton folderId={folder.id} folderName={folder.name} />
              <FolderLifecycleMenu
                folderId={folder.id}
                folderStatus={folder.status as "active" | "archived" | "trashed"}
              />
              {box && (
                <>
                  <CreateFolderDialog boxId={box.id} parentFolderId={folder.id} />
                  <FileCreateDialog boxId={box.id} folderId={folder.id} />
                  <SkillCreateDialog boxId={box.id} folderId={folder.id} />
                  <AgentCreateDialog boxId={box.id} folderId={folder.id} />
                </>
              )}
            </>
          }
        />

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">
            {/* Folder actions (rename + create note) */}
            {box && (
              <FolderWorkspaceActions folderId={folder.id} boxId={box.id} initialName={folder.name} />
            )}

            {/* AI policy */}
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">AI policy</h2>
              <FolderPolicyToggle
                folderId={folder.id}
                initialAccepts={folder.accepts_generated_notes}
              />
            </div>

            {/* Content grid */}
            {totalChildren === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
                <Folder className="mx-auto h-8 w-8 text-muted-foreground/30" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium text-foreground">Empty folder</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create content using the buttons above.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {childFolders.length > 0 && (
                  <ContentPanel
                    title={`Folders (${childFolders.length})`}
                    icon={<Folder className="h-3.5 w-3.5" />}
                    items={childFolders.map((f) => ({
                      id: f.id,
                      label: f.name,
                      href: `/app/folders/${f.id}`,
                      icon: <Folder className="h-3.5 w-3.5 text-muted-foreground" />,
                      badge: f.status === "archived" ? "archived" : undefined,
                    }))}
                  />
                )}
                {childNotes.length > 0 && (
                  <ContentPanel
                    title={`Notes (${childNotes.length})`}
                    icon={<FileText className="h-3.5 w-3.5" />}
                    items={childNotes.map((n) => ({
                      id: n.id,
                      label: n.title,
                      href: `/app/notes/${n.id}`,
                      icon: <FileText className="h-3.5 w-3.5 text-muted-foreground" />,
                      meta: n.kind !== "note" ? n.kind : undefined,
                    }))}
                  />
                )}
                {childFiles.length > 0 && (
                  <ContentPanel
                    title={`Files (${childFiles.length})`}
                    icon={<File className="h-3.5 w-3.5" />}
                    items={childFiles.map((f) => ({
                      id: f.id,
                      label: f.name,
                      href: `/app/files/${f.id}`,
                      icon: <File className="h-3.5 w-3.5 text-green-600/70" />,
                      meta: f.file_extension ?? undefined,
                    }))}
                  />
                )}
                {childSkills.length > 0 && (
                  <ContentPanel
                    title={`Skills (${childSkills.length})`}
                    icon={<Zap className="h-3.5 w-3.5" />}
                    items={childSkills.map((s) => ({
                      id: s.id,
                      label: s.name,
                      href: `/app/skills/${s.id}`,
                      icon: <Zap className="h-3.5 w-3.5 text-yellow-600/70" />,
                      meta: s.is_reusable ? "reusable" : undefined,
                    }))}
                  />
                )}
                {childAgents.length > 0 && (
                  <ContentPanel
                    title={`Agents (${childAgents.length})`}
                    icon={<Bot className="h-3.5 w-3.5" />}
                    items={childAgents.map((a) => ({
                      id: a.id,
                      label: a.name,
                      href: `/app/agents/${a.id}`,
                      icon: <Bot className="h-3.5 w-3.5 text-blue-600/70" />,
                      meta: a.is_reusable ? "reusable" : undefined,
                    }))}
                  />
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right context panel */}
      <aside
        aria-label="Folder context panel"
        className="hidden lg:flex lg:h-full lg:w-64 lg:shrink-0 lg:flex-col lg:border-l lg:border-border lg:bg-background"
      >
        <div className="flex h-full flex-col overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Folder context
            </p>
          </div>
          <ScrollArea className="flex-1">
            {/* Identity */}
            <div className="border-b border-border px-4 py-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Folder
              </p>
              <p className="mt-0.5 text-sm font-medium text-foreground">{folder.name}</p>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">
                {folder.path_cache}
              </p>
            </div>

            {/* Containing box */}
            <div className="border-b border-border px-4 py-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                {box ? "Box" : "Scope"}
              </p>
              {box ? (
                <Link
                  href={`/app/boxes/${box.id}`}
                  className="mt-0.5 text-sm text-foreground hover:underline underline-offset-2 transition-fast"
                >
                  {box.name}
                </Link>
              ) : (
                <p className="mt-0.5 text-sm text-foreground">Workspace</p>
              )}
            </div>

            {/* Stats */}
            <div className="border-b border-border px-4 py-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Contents
              </p>
              <div className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Folder className="h-3 w-3" /> Folders
                  </span>
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                    {childFolders.length}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <FileText className="h-3 w-3" /> Notes
                  </span>
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                    {childNotes.length}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <File className="h-3 w-3" /> Files
                  </span>
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                    {childFiles.length}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Zap className="h-3 w-3" /> Skills
                  </span>
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                    {childSkills.length}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Bot className="h-3 w-3" /> Agents
                  </span>
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                    {childAgents.length}
                  </Badge>
                </div>
              </div>
            </div>

            <Separator />

            {/* Details */}
            <div className="px-4 py-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Details
              </p>
              <div className="mt-1.5 flex flex-col gap-2 text-xs">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Status</p>
                  <p className="text-foreground/80 capitalize">{folder.status}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Slug</p>
                  <p className="font-mono text-foreground/80">{folder.slug}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Created</p>
                  <p className="text-foreground/80">
                    {formatAbsoluteDate(folder.created_at)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">AI writes</p>
                  <p className="text-foreground/80">
                    {folder.accepts_generated_notes ? "Allowed" : "Not allowed"}
                  </p>
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      </aside>
      </div>
    </div>
  );
}

// ─── Content panel component ─────────────────────────────────────────────────

function ContentPanel({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<{
    id: string;
    label: string;
    href: string;
    icon?: React.ReactNode;
    badge?: string;
    meta?: string;
  }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </h2>
      <div className="mt-2 space-y-0.5">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-fast hover:bg-accent/50"
          >
            {item.icon}
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge && (
              <Badge variant="secondary" className="text-[10px] font-normal">
                {item.badge}
              </Badge>
            )}
            {item.meta && (
              <span className="shrink-0 text-[10px] text-muted-foreground/50">{item.meta}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
