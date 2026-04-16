import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import {
  Archive,
  BookOpen,
  Bot,
  FileText,
  Folder,
  RotateCcw,
  Search,
} from "lucide-react";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getBoxById } from "@/server/repositories/box_repository";
import { listFoldersByBox } from "@/server/repositories/folder_repository";
import {
  listNotesByBox,
  getNoteById,
  listArchivedNotesByBox,
  listTrashedNotesByBox,
} from "@/server/repositories/note_repository";
import {
  listArchivedFoldersByBox,
  listTrashedFoldersByBox,
} from "@/server/repositories/folder_repository";
import { listLinksFromNote } from "@/server/repositories/note_link_repository";
import { getBoxOverview } from "@/server/services/overview_service";
import { EmptyState } from "@/components/product/empty_state";
import { Skeleton } from "@/components/ui/skeleton";
import { BoxContentsTree } from "@/components/product/box_contents_tree";
import { BoxGuidePanel } from "@/components/product/box_guide_panel";
import { GraphPanel } from "@/components/product/graph_panel";
import { BoxSearchPanel } from "@/components/product/box_search_panel";
import { CreateFolderDialog } from "@/components/product/create_folder_dialog";
import { CreateNoteDialog } from "@/components/product/create_note_dialog";
import { GuideNotePicker } from "@/components/product/guide_note_picker";
import { NoteStub, NoteStubSkeleton } from "@/components/product/note_stub";
import { BoxLifecycleMenu } from "@/components/product/box_lifecycle_menu";
import { FolderLifecycleMenu } from "@/components/product/folder_lifecycle_menu";
import { PanelSection } from "@/components/product/panel_section";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type NoteLink } from "@/server/domain/types/note_link";
import { BoxExportMenu } from "@/components/product/export_menu";
import {
  ImportTriggerButton,
} from "@/components/product/import_dialog";
import { FolderPolicyToggle } from "@/components/product/folder_policy_toggle";
import { BoxEditDialog } from "@/components/product/box_edit_dialog";
import { BoxOverviewPanel } from "@/components/product/box_overview_panel";
import { BoxTemplateSetup } from "@/components/product/box_template_setup";
import { WorkspaceLiveRefresh } from "@/components/product/workspace_live_refresh";
import { ActiveBranchBannerServer } from "@/components/product/active_branch_banner_server";
import { type Folder as FolderType } from "@/server/domain/types/folder";
import { type Note } from "@/server/domain/types/note";
import { formatAbsoluteDate, formatRelativeDate } from "@/lib/format_date";

// ─── Tab skeleton (generic loading state for heavy tabs) ─────────────────────

function TabSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-6 space-y-4">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  );
}

// ─── Note list skeleton ───────────────────────────────────────────────────────

function NoteListSkeleton() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2 px-6 py-4">
      {[0, 1, 2, 3].map((i) => (
        <NoteStubSkeleton key={i} />
      ))}
    </div>
  );
}

// ─── Right panel ──────────────────────────────────────────────────────────────

async function BoxContextPanel({
  box,
  guideNote,
  notes,
  folders,
  folderCount,
  noteCount,
}: {
  box: Awaited<ReturnType<typeof getBoxById>>;
  guideNote: Note | null;
  notes: Note[];
  folders: FolderType[];
  folderCount: number;
  noteCount: number;
}) {
  if (!box) return null;

  const hasGeneratedFolders = folders.some((f) => f.accepts_generated_notes);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Box context
        </p>
      </div>
      <ScrollArea className="flex-1">

        {/* Guide note — front door */}
        <div className="border-b border-border px-4 py-3">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Guide note
          </p>
          {guideNote ? (
            <div className="flex flex-col gap-2">
              {/* Guide note card */}
              <Link
                href={`/app/notes/${guideNote.id}`}
                className="flex flex-col gap-1.5 rounded-md border border-amber-300/60 bg-amber-50/40 p-3 transition-fast hover:border-amber-400/60 hover:shadow-sm dark:border-amber-600/40 dark:bg-amber-900/10"
                aria-label={`Open guide note: ${guideNote.title}`}
              >
                <div className="flex items-start gap-2">
                  <BookOpen
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500"
                    aria-hidden="true"
                  />
                  <span className="flex-1 text-sm font-medium leading-snug text-foreground hover:underline underline-offset-2">
                    {guideNote.title}
                  </span>
                </div>
                {guideNote.summary && (
                  <p className="pl-5 text-xs leading-relaxed text-muted-foreground line-clamp-3">
                    {guideNote.summary}
                  </p>
                )}
              </Link>
              {/* Assignment control inline below */}
              <GuideNotePicker
                boxId={box.id}
                currentGuideNote={guideNote}
                notes={notes}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Empty state callout */}
              <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border px-3 py-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="font-medium">No guide note</span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground/70">
                  The guide note is read first by AI agents and orients retrieval
                  for this box. Assign one below.
                </p>
              </div>
              <GuideNotePicker
                boxId={box.id}
                currentGuideNote={null}
                notes={notes}
              />
            </div>
          )}
        </div>

        {/* Box identity */}
        <div className="border-b border-border px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Box
          </p>
          <p className="mt-0.5 text-sm font-medium text-foreground">
            {box.name}
          </p>
          {box.description && (
            <p className="mt-1 text-xs text-muted-foreground">
              {box.description}
            </p>
          )}
          {box.status === "archived" && (
            <Badge
              variant="secondary"
              className="mt-2 flex w-fit items-center gap-1 text-[10px] font-normal"
            >
              <Archive className="h-3 w-3" aria-hidden="true" />
              Archived
            </Badge>
          )}
        </div>

        {/* Stats */}
        <PanelSection title="Contents" noSeparator>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <div className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-1.5">
                <Folder className="h-3 w-3" aria-hidden="true" />
                <span>Folders</span>
              </div>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                {folderCount}
              </Badge>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3 w-3" aria-hidden="true" />
                <span>Notes</span>
              </div>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                {noteCount}
              </Badge>
            </div>
          </div>
        </PanelSection>

        {/* Folder AI policies */}
        {folders.length > 0 && (
          <>
            <Separator />
            <PanelSection title="Folder policies" noSeparator>
              <div className="flex flex-col gap-1">
                <p className="mb-1 text-[10px] text-muted-foreground/70">
                  {hasGeneratedFolders
                    ? "Folders that accept AI-generated notes directly:"
                    : "No folders are open for direct AI writes."}
                </p>
                {folders.map((folder) => (
                  <div
                    key={folder.id}
                    className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Folder
                        className="h-3 w-3 shrink-0 text-muted-foreground/60"
                        aria-hidden="true"
                      />
                      <span className="truncate text-muted-foreground">
                        {folder.name}
                      </span>
                    </div>
                    <FolderPolicyToggle
                      folderId={folder.id}
                      initialAccepts={folder.accepts_generated_notes}
                      compact
                    />
                  </div>
                ))}
              </div>
            </PanelSection>
          </>
        )}

        <Separator />

        {/* Details */}
        <PanelSection title="Details" noSeparator>
          <div className="flex flex-col gap-2 text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Created
              </p>
              <p className="text-foreground/80">{formatAbsoluteDate(box.created_at)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Slug
              </p>
              <p className="font-mono text-foreground/80">{box.slug}</p>
            </div>
          </div>
        </PanelSection>
      </ScrollArea>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const VALID_BOX_TABS = ["notes", "overview", "tree", "guide", "graph", "search", "archived", "trashed"] as const;
type BoxTab = (typeof VALID_BOX_TABS)[number];

export default async function BoxPage({
  params,
  searchParams,
}: {
  params: Promise<{ box_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { box_id } = await params;
  const resolvedSearch = await searchParams;
  const rawTab = typeof resolvedSearch.tab === "string" ? resolvedSearch.tab : "notes";
  const requestedTab = VALID_BOX_TABS.includes(rawTab as BoxTab) ? (rawTab as BoxTab) : "notes";
  // Freeze "now" at server render start so every relative-date
  // computation on this page uses exactly the same reference point.
  // React hydrates the client with this frozen ISO string, so server
  // and client produce identical output. See src/lib/format_date.ts.
  const nowIso = new Date().toISOString();
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const box = await getBoxById(supabase, box_id);
  if (!box || box.workspace_id !== ctx.workspace.id) notFound();

  const [
    folders,
    notes,
    archivedNotes,
    trashedNotes,
    archivedFolders,
    trashedFolders,
  ] = await Promise.all([
    listFoldersByBox(supabase, box.id, { branchId: ctx.activeBranchId }),
    listNotesByBox(supabase, box.id, { branchId: ctx.activeBranchId }),
    listArchivedNotesByBox(supabase, box.id, { branchId: ctx.activeBranchId }),
    listTrashedNotesByBox(supabase, box.id, { branchId: ctx.activeBranchId }),
    listArchivedFoldersByBox(supabase, box.id, { branchId: ctx.activeBranchId }),
    listTrashedFoldersByBox(supabase, box.id, { branchId: ctx.activeBranchId }),
  ]);

  const guideNote = box.guide_note_id
    ? await getNoteById(supabase, box.guide_note_id)
    : null;

  const linkArrays = await Promise.all(
    notes.map((n) => listLinksFromNote(supabase, n.id, { branchId: ctx.activeBranchId }))
  );
  const allLinks: NoteLink[] = linkArrays.flat();

  const overview = await getBoxOverview(supabase, box, {
    branchId: ctx.activeBranchId,
  });

  const sortedNotes = [...notes].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  );

  const archivedCount = archivedNotes.length + archivedFolders.length;
  const trashedCount = trashedNotes.length + trashedFolders.length;

  // Guard: archived/trashed tabs are conditional; fall back to notes if empty
  const defaultTab: BoxTab =
    (requestedTab === "archived" && archivedCount === 0) ||
    (requestedTab === "trashed" && trashedCount === 0)
      ? "notes"
      : requestedTab;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ActiveBranchBannerServer />
      <div className="flex flex-1 overflow-hidden">
      <WorkspaceLiveRefresh
        workspaceId={ctx.workspace.id}
        scope="box"
        boxId={box.id}
        protectWhileEditing
      />
      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">

        {/* Box header */}
        <div className="border-b border-border px-4 py-4 md:px-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-xs text-muted-foreground">{ctx.workspace.name}</p>
                {box.status === "archived" && (
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    Archived
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground truncate">
                  {box.name}
                </h1>
                <BoxEditDialog
                  boxId={box.id}
                  initialName={box.name}
                  initialDescription={box.description}
                />
              </div>
              {box.description && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {box.description}
                </p>
              )}

              {/* Background template setup — only rendered for new empty boxes.
                  Guard: notes.length === 0 && folders.length === 0 prevents
                  re-application to boxes that already have content. */}
              {typeof resolvedSearch.setup === "string" &&
                resolvedSearch.setup.length > 0 &&
                notes.length === 0 &&
                folders.length === 0 && (
                  <BoxTemplateSetup
                    boxId={box.id}
                    templateId={resolvedSearch.setup}
                  />
                )}

              {/* Guide note — front door strip */}
              {guideNote ? (
                <Link
                  href={`/app/notes/${guideNote.id}`}
                  className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-fast group"
                  aria-label={`Open guide note: ${guideNote.title}`}
                >
                  <BookOpen
                    className="h-3.5 w-3.5 shrink-0 text-amber-600/80 dark:text-amber-500/80"
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground/70">Guide —</span>
                  <span className="font-medium text-foreground group-hover:underline underline-offset-2 truncate">
                    {guideNote.title}
                  </span>
                </Link>
              ) : (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground/50">
                  <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>No guide note — assign one in the box context panel</span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <ImportTriggerButton
                boxId={box.id}
                boxName={box.name}
                folders={folders.map((f) => ({
                  id: f.id,
                  name: f.name,
                  path_cache: f.path_cache,
                }))}
              />
              <BoxExportMenu boxId={box.id} boxName={box.name} />
              <BoxLifecycleMenu
                boxId={box.id}
                boxStatus={box.status as "active" | "archived"}
              />
              <CreateFolderDialog boxId={box.id} />
              <CreateNoteDialog boxId={box.id} folders={folders} />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue={defaultTab} className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-border px-6">
            <TabsList variant="line" className="h-auto pb-0">
              <TabsTrigger value="notes" className="pb-3">
                Notes
              </TabsTrigger>
              <TabsTrigger value="overview" className="pb-3">
                Overview
              </TabsTrigger>
              <TabsTrigger value="tree" className="pb-3">
                Tree
              </TabsTrigger>
              <TabsTrigger value="guide" className="pb-3">
                Guide
              </TabsTrigger>
              <TabsTrigger value="graph" className="pb-3">
                Graph
              </TabsTrigger>
              <TabsTrigger value="search" className="pb-3">
                <Search className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Search
              </TabsTrigger>
              {archivedCount > 0 && (
                <TabsTrigger value="archived" className="pb-3">
                  <Archive className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Archived
                  <Badge
                    variant="secondary"
                    className="ml-1.5 h-4 px-1.5 text-[10px] font-normal"
                  >
                    {archivedCount}
                  </Badge>
                </TabsTrigger>
              )}
              {trashedCount > 0 && (
                <TabsTrigger value="trashed" className="pb-3">
                  Trash
                  <Badge
                    variant="secondary"
                    className="ml-1.5 h-4 px-1.5 text-[10px] font-normal"
                  >
                    {trashedCount}
                  </Badge>
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          {/* ── Notes tab ── */}
          <TabsContent value="notes" className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <Suspense fallback={<NoteListSkeleton />}>
                {sortedNotes.length === 0 ? (
                  <EmptyState
                    icon={<FileText className="h-5 w-5" />}
                    title="No notes yet"
                    description="Create your first note, choose a starter template, or use the Import button above to bring in existing Markdown content."
                    action={<CreateNoteDialog boxId={box.id} folders={folders} />}
                    className="h-full"
                  />
                ) : (
                  <div className="mx-auto flex max-w-3xl flex-col gap-2 px-6 py-4">
                    {sortedNotes.map((note) => (
                      <Link
                        key={note.id}
                        href={`/app/notes/${note.id}`}
                        className="block rounded-lg transition-colors hover:bg-accent/30"
                      >
                        <NoteStub
                          title={note.title}
                          kind={note.kind as "note" | "guide" | "bundle"}
                          excerpt={note.summary ?? undefined}
                          updatedAt={formatRelativeDate(note.updated_at, nowIso)}
                          tags={note.tags.slice(0, 3)}
                        />
                      </Link>
                    ))}
                  </div>
                )}
              </Suspense>
            </ScrollArea>
          </TabsContent>

          {/* ── Overview tab ── */}
          <TabsContent value="overview" className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <Suspense fallback={<TabSkeleton />}>
                <div className="mx-auto max-w-3xl px-6 py-6">
                  <BoxOverviewPanel overview={overview} />
                </div>
              </Suspense>
            </ScrollArea>
          </TabsContent>

          {/* ── Tree tab ── */}
          <TabsContent value="tree" className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="mx-auto max-w-3xl px-6 py-4">
                <BoxContentsTree
                  folders={folders}
                  notes={notes}
                />
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── Guide tab ── */}
          <TabsContent value="guide" className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="mx-auto max-w-3xl px-6 py-6">
                <BoxGuidePanel
                  box={box}
                  guideNote={guideNote ?? null}
                  allNotes={notes}
                  allLinks={allLinks}
                  folders={folders}
                />
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── Graph tab ── */}
          <TabsContent value="graph" className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <Suspense fallback={<TabSkeleton />}>
                <div className="mx-auto max-w-3xl px-6 py-6">
                  <GraphPanel overview={overview} />
                </div>
              </Suspense>
            </ScrollArea>
          </TabsContent>

          {/* ── Search tab ── */}
          <TabsContent value="search" className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="mx-auto max-w-2xl px-6 py-6">
                <BoxSearchPanel
                  boxId={box.id}
                  guideNoteId={box.guide_note_id}
                />
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── Archived tab ── */}
          {archivedCount > 0 && (
            <TabsContent value="archived" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="mx-auto max-w-3xl px-6 py-4">
                  <p className="mb-3 text-xs text-muted-foreground">
                    Archived content is hidden from active views and excluded from
                    context bundles by default. Use the lifecycle menu to unarchive.
                  </p>
                  {archivedFolders.length > 0 && (
                    <div className="mb-4">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
                        Folders ({archivedFolders.length})
                      </p>
                      <div className="flex flex-col gap-1">
                        {archivedFolders.map((folder) => (
                          <div
                            key={folder.id}
                            className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <Folder
                                className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                                aria-hidden="true"
                              />
                              <span className="truncate text-sm text-foreground/80">
                                {folder.name}
                              </span>
                            </div>
                            <FolderLifecycleMenu
                              folderId={folder.id}
                              folderStatus="archived"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {archivedNotes.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
                        Notes ({archivedNotes.length})
                      </p>
                      <div className="flex flex-col gap-2">
                        {archivedNotes.map((note) => (
                          <Link key={note.id} href={`/app/notes/${note.id}`} className="block">
                            <NoteStub
                              title={note.title}
                              kind={note.kind as "note" | "guide" | "bundle"}
                              excerpt={note.summary ?? undefined}
                              updatedAt={formatRelativeDate(note.updated_at, nowIso)}
                              tags={note.tags.slice(0, 3)}
                            />
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          )}

          {/* ── Trashed tab ── */}
          {trashedCount > 0 && (
            <TabsContent value="trashed" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="mx-auto max-w-3xl px-6 py-4">
                  <p className="mb-3 text-xs text-muted-foreground">
                    Trashed content is excluded from retrieval and context bundles.
                    Restore to make it active again.
                  </p>
                  {trashedFolders.length > 0 && (
                    <div className="mb-4">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
                        Folders ({trashedFolders.length})
                      </p>
                      <div className="flex flex-col gap-1">
                        {trashedFolders.map((folder) => (
                          <div
                            key={folder.id}
                            className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <Folder
                                className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                                aria-hidden="true"
                              />
                              <span className="truncate text-sm text-foreground/80">
                                {folder.name}
                              </span>
                            </div>
                            <FolderLifecycleMenu
                              folderId={folder.id}
                              folderStatus="trashed"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {trashedNotes.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
                        Notes ({trashedNotes.length})
                      </p>
                      <div className="flex flex-col gap-2">
                        {trashedNotes.map((note) => (
                          <Link key={note.id} href={`/app/notes/${note.id}`} className="block">
                            <NoteStub
                              title={note.title}
                              kind={note.kind as "note" | "guide" | "bundle"}
                              excerpt={note.summary ?? undefined}
                              updatedAt={formatRelativeDate(note.updated_at, nowIso)}
                              tags={note.tags.slice(0, 3)}
                            />
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Right panel */}
      <aside
        aria-label="Box context panel"
        className="hidden lg:flex lg:h-full lg:w-72 lg:shrink-0 lg:flex-col lg:border-l lg:border-border lg:bg-background"
      >
        <BoxContextPanel
          box={box}
          guideNote={guideNote}
          notes={notes}
          folders={folders}
          folderCount={folders.length}
          noteCount={notes.length}
        />
      </aside>
      </div>
    </div>
  );
}
