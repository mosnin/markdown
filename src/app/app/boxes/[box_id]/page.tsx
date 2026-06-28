import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import dynamic from "next/dynamic";
import {
  Archive,
  BookOpen,
  ChevronRight,
  Clock,
  FileText,
  Folder,
  Hash,
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
import { listLinksFromNotes } from "@/server/repositories/note_link_repository";
import { getBoxOverview } from "@/server/services/overview_service";
import { EmptyState } from "@/components/product/empty_state";
import { Skeleton } from "@/components/ui/skeleton";
import { BoxContentsTree } from "@/components/product/boxes/box_contents_tree";
import { GuideNotePicker } from "@/components/product/guide_note_picker";
import { NoteStub, NoteStubSkeleton } from "@/components/product/notes/note_stub";
import { FolderLifecycleMenu } from "@/components/product/folders/folder_lifecycle_menu";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { type NoteLink } from "@/server/domain/types/note_link";
import { CreateNoteDialog } from "@/components/product/create/create_note_dialog";
import { listTemplates } from "@/server/services/note_template_service";
import { FolderPolicyToggle } from "@/components/product/folders/folder_policy_toggle";
import { BoxEditDialog } from "@/components/product/boxes/box_edit_dialog";
import { BoxTemplateSetup } from "@/components/product/boxes/box_template_setup";
import { BoxChatPanel } from "@/components/product/boxes/box_chat_panel";
import { BoxActionBar } from "@/components/product/boxes/box_action_bar";
import { WorkspaceLiveRefresh } from "@/components/product/workspace/workspace_live_refresh";
import { ActiveBranchBannerServer } from "@/components/product/active_branch_banner_server";
import { type Folder as FolderType } from "@/server/domain/types/folder";
import { type Note } from "@/server/domain/types/note";
import { formatAbsoluteDate, formatRelativeDate } from "@/lib/format_date";

// Heavy, tab-only panels are code-split (next/dynamic) so they stay OUT of the
// box route's initial JS bundle — they download only when their tab is opened,
// not on every box open. Radix unmounts inactive tabs, so on the default Notes
// tab these never load. This removes the bulk of the client-side box-open cost.
const GraphPanel = dynamic(() =>
  import("@/components/product/graph_panel").then((m) => ({ default: m.GraphPanel })),
);
const BoxSearchPanel = dynamic(() =>
  import("@/components/product/boxes/box_search_panel").then((m) => ({
    default: m.BoxSearchPanel,
  })),
);
const BoxOverviewPanel = dynamic(() =>
  import("@/components/product/boxes/box_overview_panel").then((m) => ({
    default: m.BoxOverviewPanel,
  })),
);
const BoxGuidePanel = dynamic(() =>
  import("@/components/product/boxes/box_guide_panel").then((m) => ({
    default: m.BoxGuidePanel,
  })),
);

// ─── Shared tokens ──────────────────────────────────────────────────────────
//
// The app's NEW aesthetic (see boxes_bento / floating_shell / the note page):
// soft rounded `bg-card` surfaces, a single quiet shadow, no hard borders.

const SOFT_SHADOW =
  "shadow-[0_2px_12px_-2px_rgba(0,0,0,0.07),0_1px_4px_-1px_rgba(0,0,0,0.05)]";
const SECTION_LABEL =
  "text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground";

// ─── Soft tab strip ───────────────────────────────────────────────────────────
// Uses Radix `Tabs` (so the Suspense-streamed per-tab content keeps mounting on
// switch) but styled as the app's soft segmented control: a rounded `bg-muted`
// track with rounded active pills — no sharp underline.

const TAB_LIST =
  "h-auto w-fit max-w-full flex-nowrap gap-1 overflow-x-auto rounded-full bg-muted/60 p-1";
const TAB_TRIGGER =
  "h-auto flex-none rounded-full px-3 py-1.5 text-xs font-medium data-active:bg-card data-active:text-foreground data-active:shadow-[0_1px_4px_-1px_rgba(0,0,0,0.12),0_1px_2px_-1px_rgba(0,0,0,0.06)]";

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({
  workspaceName,
  boxName,
}: {
  workspaceName: string;
  boxName: string;
}) {
  const parts = [
    { label: workspaceName, href: "/app" as string | null },
    { label: boxName, href: null as string | null },
  ];

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {parts.map((part, i) => (
        <span key={`${part.label}-${i}`} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />}
          {part.href ? (
            <Link href={part.href} className="rounded-md transition-fast hover:text-foreground">
              {part.label}
            </Link>
          ) : (
            <span className="max-w-[220px] truncate font-medium text-foreground/80" title={part.label}>
              {part.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

// ─── Right-panel building blocks (mirrors the note page) ─────────────────────

/** A soft rounded card used to group a section of the right context panel. */
function PanelCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl bg-card", SOFT_SHADOW, className)}>
      {children}
    </div>
  );
}

function InfoSection({
  children,
  border = true,
}: {
  children: React.ReactNode;
  border?: boolean;
}) {
  return (
    <div className={cn("px-4 py-3.5", border && "border-b border-border/50")}>
      {children}
    </div>
  );
}

function InfoLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
      {children}
    </p>
  );
}

// ─── Tab skeleton (generic loading state for heavy tabs) ─────────────────────

function TabSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-6 space-y-4">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 w-full rounded-2xl" />
      ))}
    </div>
  );
}

// ─── Note list skeleton ───────────────────────────────────────────────────────

function NoteListSkeleton() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2 px-6 py-5">
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
      {/* Panel header */}
      <div className="shrink-0 px-4 pb-3 pt-4">
        <p className={SECTION_LABEL}>Box context</p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-4 pb-6">
          {/* Guide note — front door */}
          <PanelCard>
            <div className="px-4 pb-1 pt-3.5">
              <p className={SECTION_LABEL}>Guide note</p>
            </div>
            {guideNote ? (
              <div className="flex flex-col gap-2 px-4 pb-4 pt-2">
                {/* Guide note card */}
                <Link
                  href={`/app/notes/${guideNote.id}`}
                  className="flex flex-col gap-1.5 rounded-2xl border border-amber-300/50 bg-amber-50/50 p-3 transition-fast hover:border-amber-400/60 dark:border-amber-600/30 dark:bg-amber-900/10"
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
              <div className="flex flex-col gap-2 px-4 pb-4 pt-2">
                {/* Empty state callout */}
                <div className="flex flex-col gap-1.5 rounded-2xl border border-dashed border-border/70 px-3 py-3">
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
          </PanelCard>

          {/* About card — identity, stats, details */}
          <PanelCard>
            {/* Box identity */}
            <InfoSection>
              <InfoLabel>Box</InfoLabel>
              <p className="text-sm font-medium text-foreground">{box.name}</p>
              {box.description && (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {box.description}
                </p>
              )}
              {box.status === "archived" && (
                <Badge
                  variant="secondary"
                  className="mt-2 flex w-fit items-center gap-1 rounded-full text-[10px] font-normal"
                >
                  <Archive className="h-3 w-3" aria-hidden="true" />
                  Archived
                </Badge>
              )}
            </InfoSection>

            {/* Stats */}
            <InfoSection>
              <InfoLabel>Contents</InfoLabel>
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <div className="flex items-center justify-between py-0.5">
                  <div className="flex items-center gap-1.5">
                    <Folder className="h-3 w-3" aria-hidden="true" />
                    <span>Folders</span>
                  </div>
                  <Badge variant="secondary" className="h-4 rounded-full px-1.5 text-[10px] font-normal">
                    {folderCount}
                  </Badge>
                </div>
                <div className="flex items-center justify-between py-0.5">
                  <div className="flex items-center gap-1.5">
                    <FileText className="h-3 w-3" aria-hidden="true" />
                    <span>Notes</span>
                  </div>
                  <Badge variant="secondary" className="h-4 rounded-full px-1.5 text-[10px] font-normal">
                    {noteCount}
                  </Badge>
                </div>
              </div>
            </InfoSection>

            {/* Details */}
            <InfoSection border={false}>
              <InfoLabel>Details</InfoLabel>
              <div className="flex flex-col gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  <span className="text-foreground/70">{formatAbsoluteDate(box.created_at)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  <span className="font-mono text-[11px] text-foreground/70">{box.slug}</span>
                </div>
              </div>
            </InfoSection>
          </PanelCard>

          {/* Folder AI policies */}
          {folders.length > 0 && (
            <PanelCard>
              <div className="px-4 pb-1 pt-3.5">
                <p className={SECTION_LABEL}>Folder policies</p>
              </div>
              <div className="px-4 pb-3.5 pt-2">
                <p className="mb-2 text-[11px] text-muted-foreground/70">
                  {hasGeneratedFolders
                    ? "Folders that accept AI-generated notes directly:"
                    : "No folders are open for direct AI writes."}
                </p>
                <div className="flex flex-col gap-0.5">
                  {folders.map((folder) => (
                    <div
                      key={folder.id}
                      className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 text-xs"
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
              </div>
            </PanelCard>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Deferred tab content ────────────────────────────────────────────────────
// Streamed inside <Suspense> so the page shell + the default Notes tab paint
// immediately; the heavier per-tab work (box overview, guide-note links) loads
// independently instead of blocking first paint.

type LoadedBox = NonNullable<Awaited<ReturnType<typeof getBoxById>>>;

// Per-request memoized overview. The Overview and Graph tabs both render
// server-side, but pass the SAME box reference, so cache() runs the (heavier)
// overview computation exactly once per request.
const loadOverview = cache(async (box: LoadedBox, branchId: string | null) =>
  getBoxOverview(await createClient(), box, { branchId })
);

async function OverviewTabContent({
  box,
  branchId,
}: {
  box: LoadedBox;
  branchId: string | null;
}) {
  return <BoxOverviewPanel overview={await loadOverview(box, branchId)} />;
}

async function GraphTabContent({
  box,
  branchId,
}: {
  box: LoadedBox;
  branchId: string | null;
}) {
  return <GraphPanel overview={await loadOverview(box, branchId)} />;
}

async function GuideTabContent({
  box,
  guideNote,
  notes,
  folders,
  branchId,
}: {
  box: LoadedBox;
  guideNote: Note | null;
  notes: Note[];
  folders: FolderType[];
  branchId: string | null;
}) {
  const supabase = await createClient();
  const allLinks: NoteLink[] = await listLinksFromNotes(
    supabase,
    notes.map((n) => n.id),
    { branchId }
  );
  return (
    <BoxGuidePanel
      box={box}
      guideNote={guideNote ?? null}
      allNotes={notes}
      allLinks={allLinks}
      folders={folders}
    />
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
  const __pt0 = performance.now();
  const ctx = await requireAuthenticatedUser();
  const __pt1 = performance.now();
  const supabase = await createClient();

  // Fetch the box AND its contents in ONE parallel batch. The list queries key
  // off the route's box_id (identical to box.id), so they no longer wait for
  // getBoxById first — this overlaps what used to be two sequential ~300ms
  // round-trips. Box existence/ownership is validated immediately after.
  const [
    box,
    folders,
    notes,
    archivedNotes,
    trashedNotes,
    archivedFolders,
    trashedFolders,
    savedTemplates,
  ] = await Promise.all([
    getBoxById(supabase, box_id),
    listFoldersByBox(supabase, box_id, { branchId: ctx.activeBranchId }),
    listNotesByBox(supabase, box_id, { branchId: ctx.activeBranchId }),
    listArchivedNotesByBox(supabase, box_id, { branchId: ctx.activeBranchId }),
    listTrashedNotesByBox(supabase, box_id, { branchId: ctx.activeBranchId }),
    listArchivedFoldersByBox(supabase, box_id, { branchId: ctx.activeBranchId }),
    listTrashedFoldersByBox(supabase, box_id, { branchId: ctx.activeBranchId }),
    listTemplates(supabase, box_id),
  ]);
  const __pt2 = performance.now();
  if (!box || box.workspace_id !== ctx.workspace.id) notFound();

  const guideNote = box.guide_note_id
    ? await getNoteById(supabase, box.guide_note_id)
    : null;
  const __pt4 = performance.now();
  // [perf] server timing (invisible — server log only).
  console.log(
    `[perf] box ${box_id} notes=${notes.length} folders=${folders.length} ` +
      `ctx=${(__pt1 - __pt0).toFixed(0)}ms fetch=${(__pt2 - __pt1).toFixed(0)}ms ` +
      `guide=${(__pt4 - __pt2).toFixed(0)}ms serverTotal=${(__pt4 - __pt0).toFixed(0)}ms`,
  );

  const sortedNotes = [...notes].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  );

  const savedTemplateRefs = savedTemplates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    markdown_content: t.markdown_content,
  }));

  const archivedCount = archivedNotes.length + archivedFolders.length;
  const trashedCount = trashedNotes.length + trashedFolders.length;

  // Guard: archived/trashed tabs are conditional; fall back to notes if empty
  const defaultTab: BoxTab =
    (requestedTab === "archived" && archivedCount === 0) ||
    (requestedTab === "trashed" && trashedCount === 0)
      ? "notes"
      : requestedTab;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <ActiveBranchBannerServer />
      <div className="flex flex-1 overflow-hidden">
        <WorkspaceLiveRefresh
          workspaceId={ctx.workspace.id}
          scope="box"
          boxId={box.id}
          protectWhileEditing
        />

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden pb-16">
          {/* ── Header: breadcrumb + title + actions ── */}
          <div className="shrink-0 px-4 pt-5 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Breadcrumb workspaceName={ctx.workspace.name} boxName={box.name} />
                <div className="flex items-center gap-2">
                  <p className={SECTION_LABEL}>Box</p>
                  {box.status === "archived" && (
                    <Badge
                      variant="secondary"
                      className="flex shrink-0 items-center gap-1 rounded-full text-[10px] font-normal"
                    >
                      <Archive className="h-3 w-3" aria-hidden="true" />
                      Archived
                    </Badge>
                  )}
                </div>

                {/* Title + inline edit */}
                <div className="flex items-center gap-1">
                  <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
                    {box.name}
                  </h1>
                  <BoxEditDialog
                    boxId={box.id}
                    initialName={box.name}
                    initialDescription={box.description}
                    initialAgentInstructions={box.agent_instructions}
                  />
                </div>
                {box.description && (
                  <p className="text-sm text-muted-foreground">{box.description}</p>
                )}

                {/* Background template setup — only rendered for new empty boxes.
                    Guard: notes.length === 0 && folders.length === 0 prevents
                    re-application to boxes that already have content. */}
                {typeof resolvedSearch.setup === "string" &&
                  resolvedSearch.setup.length > 0 &&
                  notes.length === 0 &&
                  folders.length === 0 && (
                    <BoxTemplateSetup boxId={box.id} templateId={resolvedSearch.setup} />
                  )}

                {/* Guide note — front door strip */}
                {guideNote ? (
                  <Link
                    href={`/app/notes/${guideNote.id}`}
                    className="group mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground transition-fast hover:text-foreground"
                    aria-label={`Open guide note: ${guideNote.title}`}
                  >
                    <BookOpen
                      className="h-3.5 w-3.5 shrink-0 text-amber-600/80 dark:text-amber-500/80"
                      aria-hidden="true"
                    />
                    <span className="text-muted-foreground/70">Guide —</span>
                    <span className="truncate font-medium text-foreground underline-offset-2 group-hover:underline">
                      {guideNote.title}
                    </span>
                  </Link>
                ) : (
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground/50">
                    <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>No guide note — assign one in the box context panel</span>
                  </div>
                )}
              </div>

              <BoxActionBar
                boxId={box.id}
                boxName={box.name}
                boxStatus={box.status as "active" | "archived"}
                isPublic={box.is_public}
                folders={folders}
                savedTemplates={savedTemplateRefs}
              />
            </div>
          </div>

          {/* ── Tabs ── */}
          <Tabs defaultValue={defaultTab} className="flex flex-1 flex-col overflow-hidden">
            <div className="shrink-0 px-4 pt-4 sm:px-6 lg:px-8">
              <TabsList className={TAB_LIST}>
                <TabsTrigger value="notes" className={TAB_TRIGGER}>
                  Notes
                </TabsTrigger>
                <TabsTrigger value="overview" className={TAB_TRIGGER}>
                  Overview
                </TabsTrigger>
                <TabsTrigger value="tree" className={TAB_TRIGGER}>
                  Tree
                </TabsTrigger>
                <TabsTrigger value="guide" className={TAB_TRIGGER}>
                  Guide
                </TabsTrigger>
                <TabsTrigger value="graph" className={TAB_TRIGGER}>
                  Graph
                </TabsTrigger>
                <TabsTrigger value="search" className={TAB_TRIGGER}>
                  <Search className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Search
                </TabsTrigger>
                {archivedCount > 0 && (
                  <TabsTrigger value="archived" className={TAB_TRIGGER}>
                    <Archive className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Archived
                    <Badge
                      variant="secondary"
                      className="ml-1.5 h-4 rounded-full px-1.5 text-[10px] font-normal"
                    >
                      {archivedCount}
                    </Badge>
                  </TabsTrigger>
                )}
                {trashedCount > 0 && (
                  <TabsTrigger value="trashed" className={TAB_TRIGGER}>
                    Trash
                    <Badge
                      variant="secondary"
                      className="ml-1.5 h-4 rounded-full px-1.5 text-[10px] font-normal"
                    >
                      {trashedCount}
                    </Badge>
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            {/* ── Notes tab ── */}
            <TabsContent value="notes" className="min-h-0 flex-1 overflow-hidden">
              <div className="h-full px-4 pb-4 pt-4 sm:px-6 sm:pb-6 lg:px-8">
                <div className={cn("h-full overflow-hidden rounded-3xl bg-card", SOFT_SHADOW)}>
                  <ScrollArea className="h-full">
                    <Suspense fallback={<NoteListSkeleton />}>
                      {sortedNotes.length === 0 ? (
                        <EmptyState
                          icon={<FileText className="h-5 w-5" />}
                          title="No notes yet"
                          description="Create your first note, choose a starter template, or use the Import button above to bring in existing Markdown content."
                          action={
                            <CreateNoteDialog
                              boxId={box.id}
                              folders={folders}
                              savedTemplates={savedTemplateRefs}
                            />
                          }
                          className="h-full"
                        />
                      ) : (
                        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-6 py-5">
                          {sortedNotes.map((note) => (
                            <Link
                              key={note.id}
                              href={`/app/notes/${note.id}`}
                              className="block rounded-2xl transition-colors hover:bg-accent/40"
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
                </div>
              </div>
            </TabsContent>

            {/* ── Overview tab ── */}
            <TabsContent value="overview" className="min-h-0 flex-1 overflow-hidden">
              <div className="h-full px-4 pb-4 pt-4 sm:px-6 sm:pb-6 lg:px-8">
                <div className={cn("h-full overflow-hidden rounded-3xl bg-card", SOFT_SHADOW)}>
                  <ScrollArea className="h-full">
                    <Suspense fallback={<TabSkeleton />}>
                      <div className="mx-auto max-w-3xl px-6 py-6">
                        <OverviewTabContent box={box} branchId={ctx.activeBranchId} />
                      </div>
                    </Suspense>
                  </ScrollArea>
                </div>
              </div>
            </TabsContent>

            {/* ── Tree tab ── */}
            <TabsContent value="tree" className="min-h-0 flex-1 overflow-hidden">
              <div className="h-full px-4 pb-4 pt-4 sm:px-6 sm:pb-6 lg:px-8">
                <div className={cn("h-full overflow-hidden rounded-3xl bg-card", SOFT_SHADOW)}>
                  <ScrollArea className="h-full">
                    <div className="mx-auto max-w-3xl px-6 py-5">
                      <BoxContentsTree folders={folders} notes={notes} />
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </TabsContent>

            {/* ── Guide tab ── */}
            <TabsContent value="guide" className="min-h-0 flex-1 overflow-hidden">
              <div className="h-full px-4 pb-4 pt-4 sm:px-6 sm:pb-6 lg:px-8">
                <div className={cn("h-full overflow-hidden rounded-3xl bg-card", SOFT_SHADOW)}>
                  <ScrollArea className="h-full">
                    <Suspense fallback={<TabSkeleton />}>
                      <div className="mx-auto max-w-3xl px-6 py-6">
                        <GuideTabContent
                          box={box}
                          guideNote={guideNote}
                          notes={notes}
                          folders={folders}
                          branchId={ctx.activeBranchId}
                        />
                      </div>
                    </Suspense>
                  </ScrollArea>
                </div>
              </div>
            </TabsContent>

            {/* ── Graph tab ── */}
            <TabsContent value="graph" className="min-h-0 flex-1 overflow-hidden">
              <div className="h-full px-4 pb-4 pt-4 sm:px-6 sm:pb-6 lg:px-8">
                <div className={cn("h-full overflow-hidden rounded-3xl bg-card", SOFT_SHADOW)}>
                  <ScrollArea className="h-full">
                    <Suspense fallback={<TabSkeleton />}>
                      <div className="mx-auto max-w-3xl px-6 py-6">
                        <GraphTabContent box={box} branchId={ctx.activeBranchId} />
                      </div>
                    </Suspense>
                  </ScrollArea>
                </div>
              </div>
            </TabsContent>

            {/* ── Search tab ── */}
            <TabsContent value="search" className="min-h-0 flex-1 overflow-hidden">
              <div className="h-full px-4 pb-4 pt-4 sm:px-6 sm:pb-6 lg:px-8">
                <div className={cn("h-full overflow-hidden rounded-3xl bg-card", SOFT_SHADOW)}>
                  <ScrollArea className="h-full">
                    <div className="mx-auto max-w-2xl px-6 py-6">
                      <BoxSearchPanel boxId={box.id} guideNoteId={box.guide_note_id} />
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </TabsContent>

            {/* ── Archived tab ── */}
            {archivedCount > 0 && (
              <TabsContent value="archived" className="min-h-0 flex-1 overflow-hidden">
                <div className="h-full px-4 pb-4 pt-4 sm:px-6 sm:pb-6 lg:px-8">
                  <div className={cn("h-full overflow-hidden rounded-3xl bg-card", SOFT_SHADOW)}>
                    <ScrollArea className="h-full">
                      <div className="mx-auto max-w-3xl px-6 py-5">
                        <p className="mb-3 text-xs text-muted-foreground">
                          Archived content is hidden from active views and excluded from
                          context bundles by default. Use the lifecycle menu to unarchive.
                        </p>
                        {archivedFolders.length > 0 && (
                          <div className="mb-4">
                            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
                              Folders ({archivedFolders.length})
                            </p>
                            <div className="flex flex-col gap-1.5">
                              {archivedFolders.map((folder) => (
                                <div
                                  key={folder.id}
                                  className="flex items-center justify-between gap-2 rounded-2xl border border-border/50 px-3 py-2"
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
                            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
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
                  </div>
                </div>
              </TabsContent>
            )}

            {/* ── Trashed tab ── */}
            {trashedCount > 0 && (
              <TabsContent value="trashed" className="min-h-0 flex-1 overflow-hidden">
                <div className="h-full px-4 pb-4 pt-4 sm:px-6 sm:pb-6 lg:px-8">
                  <div className={cn("h-full overflow-hidden rounded-3xl bg-card", SOFT_SHADOW)}>
                    <ScrollArea className="h-full">
                      <div className="mx-auto max-w-3xl px-6 py-5">
                        <p className="mb-3 text-xs text-muted-foreground">
                          Trashed content is excluded from retrieval and context bundles.
                          Restore to make it active again.
                        </p>
                        {trashedFolders.length > 0 && (
                          <div className="mb-4">
                            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
                              Folders ({trashedFolders.length})
                            </p>
                            <div className="flex flex-col gap-1.5">
                              {trashedFolders.map((folder) => (
                                <div
                                  key={folder.id}
                                  className="flex items-center justify-between gap-2 rounded-2xl border border-border/50 px-3 py-2"
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
                            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
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
                  </div>
                </div>
              </TabsContent>
            )}
          </Tabs>
        </div>

        {/* Right panel — box context */}
        <aside
          aria-label="Box context panel"
          className="hidden lg:flex lg:h-full lg:w-[22rem] lg:shrink-0 lg:flex-col lg:overflow-hidden lg:pr-4"
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
      <BoxChatPanel
        workspaceId={ctx.workspace.id}
        boxId={box.id}
        boxName={box.name}
      />
    </div>
  );
}
