import { notFound } from "next/navigation";
import {
  Archive,
  BookOpen,
  Bot,
  ChevronRight,
  Clock,
  GitBranch,
  History,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNoteById, listNotesByBox } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { getFolderById } from "@/server/repositories/folder_repository";
import { getConnectionById } from "@/server/repositories/connection_repository";
import { listLinksForNote } from "@/server/services/link_service";
import { assembleContextBundle } from "@/server/services/context_bundle_service";
import { auditBundleRead } from "@/server/services/audit_service";
import { listVersionsForNote } from "@/server/services/version_history_service";
import { NoteEditor } from "@/components/product/note_editor";
import { SemanticLinksPanel } from "@/components/product/semantic_links_panel";
import { ContextBundleViewer } from "@/components/product/context_bundle_viewer";
import { NoteHistoryPanel } from "@/components/product/note_history_panel";
import { NoteExportMenu } from "@/components/product/export_menu";
import { NoteImportButton } from "@/components/product/note_import_dialog";
import { NoteLifecycleMenu } from "@/components/product/note_lifecycle_menu";
import { GeneratedNoteBanner } from "@/components/product/generated_note_banner";
import { RetrievalHintBadge } from "@/components/product/retrieval_hint_badge";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { WorkspaceLiveRefresh } from "@/components/product/workspace_live_refresh";
import { ActiveBranchBannerServer } from "@/components/product/active_branch_banner_server";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeDate(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return formatDate(dateStr);
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({
  workspaceName,
  boxId,
  boxName,
  folderName,
  noteTitle,
}: {
  workspaceName: string;
  boxId: string;
  boxName: string;
  folderName: string | null;
  noteTitle: string;
}) {
  const parts = [
    { label: workspaceName, href: "/app" },
    { label: boxName, href: `/app/boxes/${boxId}` },
    ...(folderName ? [{ label: folderName, href: null as string | null }] : []),
    { label: noteTitle, href: null as string | null },
  ];

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
      {parts.map((part, i) => (
        <span key={`${part.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />}
          {part.href ? (
            <Link
              href={part.href}
              className="hover:text-foreground hover:underline underline-offset-2 transition-fast"
            >
              {part.label}
            </Link>
          ) : i === parts.length - 1 ? (
            /* Current page — note title shown with stronger contrast */
            <span className="max-w-[180px] truncate text-foreground/80 font-medium" title={part.label}>
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

// ─── Info tab sections ────────────────────────────────────────────────────────

function InfoSection({
  children,
  border = true,
}: {
  children: React.ReactNode;
  border?: boolean;
}) {
  return (
    <div className={cn("px-4 py-3", border && "border-b border-border")}>
      {children}
    </div>
  );
}

function InfoLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
      {children}
    </p>
  );
}

// ─── Right panel — Note context ───────────────────────────────────────────────

const VALID_TABS = ["info", "links", "bundle", "history"] as const;
type NoteContextTab = (typeof VALID_TABS)[number];

function NoteContextPanel({
  note,
  boxId,
  boxName,
  folderName,
  workspaceName,
  isGuideNote,
  generatingConnectionName,
  links,
  allBoxNotes,
  initialBundle,
  historyResult,
  defaultTab = "info",
}: {
  note: NonNullable<Awaited<ReturnType<typeof getNoteById>>>;
  boxId: string;
  boxName: string;
  folderName: string | null;
  workspaceName: string;
  isGuideNote: boolean;
  generatingConnectionName: string | null;
  links: {
    outgoing: Awaited<ReturnType<typeof listLinksForNote>>["outgoing"];
    incoming: Awaited<ReturnType<typeof listLinksForNote>>["incoming"];
  };
  allBoxNotes: Awaited<ReturnType<typeof listNotesByBox>>;
  initialBundle: Awaited<ReturnType<typeof assembleContextBundle>>;
  historyResult: Awaited<ReturnType<typeof listVersionsForNote>>;
  defaultTab?: NoteContextTab;
}) {
  const kindLabel: Record<string, string> = {
    note: "Note",
    guide: "Guide",
    bundle: "Bundle",
  };

  const ORIGIN_TYPE_LABEL: Record<string, string> = {
    user_created: "User created",
    imported: "Imported",
    generated_by_tool: "AI generated",
    duplicated: "Duplicated",
    restored: "Restored",
  };

  const hasRetrieval =
    !!note.read_hint || note.retrieval_priority > 0;

  const linkCount = links.outgoing.length + links.incoming.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Panel header */}
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Note context
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue={defaultTab} className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border px-4">
          <TabsList variant="line" className="h-auto pb-0">
            <TabsTrigger value="info" className="pb-2.5 text-xs">
              Info
            </TabsTrigger>
            <TabsTrigger value="links" className="relative pb-2.5 text-xs">
              Links
              {linkCount > 0 && (
                <span className="ml-1 rounded-full bg-muted px-1 text-[10px] text-muted-foreground">
                  {linkCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="bundle" className="pb-2.5 text-xs">
              Bundle
            </TabsTrigger>
            <TabsTrigger value="history" className="pb-2.5 text-xs">
              History
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── Info tab ── */}
        <TabsContent value="info" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">

            {/* Guide note callout — shown prominently when this IS the guide */}
            {isGuideNote && (
              <div className="border-b border-amber-300/50 bg-amber-50/40 px-4 py-3 dark:border-amber-600/30 dark:bg-amber-900/10">
                <div className="flex items-center gap-2">
                  <BookOpen
                    className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500"
                    aria-hidden="true"
                  />
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    This is the guide note for{" "}
                    <Link
                      href={`/app/boxes/${boxId}`}
                      className="underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-300 transition-fast"
                    >
                      {boxName}
                    </Link>
                  </p>
                </div>
                <p className="mt-1 pl-5 text-[11px] text-amber-700/70 dark:text-amber-400/70">
                  AI agents read this note first when assembling context for
                  this box.
                </p>
              </div>
            )}

            {/* Identity */}
            <InfoSection>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {note.kind === "guide" ? (
                  <Badge
                    variant="secondary"
                    className="flex items-center gap-1 text-[10px] font-normal border-amber-300/60 bg-amber-50/60 text-amber-700 dark:border-amber-600/40 dark:bg-amber-900/20 dark:text-amber-400"
                  >
                    <BookOpen className="h-2.5 w-2.5" aria-hidden="true" />
                    Guide note
                  </Badge>
                ) : note.kind !== "note" ? (
                  <Badge variant="secondary" className="text-[10px] font-normal capitalize">
                    {kindLabel[note.kind] ?? note.kind}
                  </Badge>
                ) : null}
              </div>
              <p className="line-clamp-3 text-sm font-medium text-foreground">
                {note.title}
              </p>
            </InfoSection>

            {/* Summary — first-class, not buried at bottom */}
            {note.summary && (
              <InfoSection>
                <InfoLabel>Summary</InfoLabel>
                <p className="text-xs leading-relaxed text-foreground/80">
                  {note.summary}
                </p>
              </InfoSection>
            )}

            {/* Retrieval signals */}
            {hasRetrieval && (
              <InfoSection>
                <InfoLabel>Retrieval</InfoLabel>
                <RetrievalHintBadge
                  readHint={note.read_hint}
                  retrievalPriority={note.retrieval_priority}
                />
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/60">
                  {note.retrieval_priority > 0 &&
                    "Priority affects context bundle inclusion order. "}
                  {note.read_hint &&
                    "Read hint guides AI and human readers on how to use this note."}
                </p>
              </InfoSection>
            )}

            {/* Tags */}
            {note.tags.length > 0 && (
              <InfoSection>
                <InfoLabel>Tags</InfoLabel>
                <div className="flex flex-wrap gap-1">
                  {note.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs font-normal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </InfoSection>
            )}

            {/* Location */}
            <InfoSection>
              <InfoLabel>Location</InfoLabel>
              <nav
                aria-label="Note location"
                className="flex items-center gap-1 flex-wrap text-xs text-muted-foreground"
              >
                <Link
                  href="/app"
                  className="hover:text-foreground hover:underline underline-offset-2 transition-fast"
                >
                  {workspaceName}
                </Link>
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                <Link
                  href={`/app/boxes/${boxId}`}
                  className="hover:text-foreground hover:underline underline-offset-2 transition-fast"
                >
                  {boxName}
                </Link>
                {folderName && (
                  <>
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                    <span>{folderName}</span>
                  </>
                )}
              </nav>
              {note.path_cache && (
                <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/50">
                  {note.path_cache}
                </p>
              )}
            </InfoSection>

            {/* Machine origin — shown when note is generated */}
            {note.is_generated && (
              <InfoSection>
                <InfoLabel>Machine origin</InfoLabel>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      Generated by{" "}
                      {generatingConnectionName ? (
                        <span className="font-medium text-foreground/80">
                          {generatingConnectionName}
                        </span>
                      ) : (
                        "an external tool"
                      )}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground/60">
                    Promote this note to take ownership. Provenance and history
                    are preserved.
                  </p>
                </div>
              </InfoSection>
            )}

            {/* Version */}
            <InfoSection border={false}>
              <InfoLabel>Version</InfoLabel>
              <div className="flex flex-col gap-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <GitBranch
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                  <span className="font-mono text-[11px] text-foreground/70">
                    {note.current_version_id
                      ? note.current_version_id.slice(0, 8) + "…"
                      : "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                  <span className="text-foreground/70">
                    {formatRelativeDate(note.updated_at)}
                  </span>
                </div>
                {note.origin_type && note.origin_type !== "user_created" && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground/50">Origin:</span>
                    <span className="text-foreground/70">
                      {ORIGIN_TYPE_LABEL[note.origin_type] ?? note.origin_type}
                    </span>
                  </div>
                )}
              </div>
            </InfoSection>
          </ScrollArea>
        </TabsContent>

        {/* ── Links tab ── */}
        <TabsContent value="links" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-4 py-3">
              <SemanticLinksPanel
                sourceNoteId={note.id}
                outgoing={links.outgoing}
                incoming={links.incoming}
                allBoxNotes={allBoxNotes}
              />
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Bundle tab ── */}
        <TabsContent value="bundle" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-4 py-3">
              <ContextBundleViewer
                initialBundle={initialBundle}
                noteId={note.id}
              />
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── History tab ── */}
        <TabsContent value="history" className="flex-1 overflow-hidden">
          <NoteHistoryPanel
            noteId={note.id}
            initialVersions={historyResult.versions}
            currentVersionId={historyResult.current_version_id}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function NotePage({
  params,
  searchParams,
}: {
  params: Promise<{ note_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { note_id } = await params;
  const resolvedSearch = await searchParams;
  const rawTab = typeof resolvedSearch.tab === "string" ? resolvedSearch.tab : "info";
  const defaultTab: NoteContextTab = VALID_TABS.includes(rawTab as NoteContextTab)
    ? (rawTab as NoteContextTab)
    : "info";
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const note = await getNoteById(supabase, note_id);
  if (!note) notFound();

  const box = await getBoxById(supabase, note.box_id);
  if (!box || box.workspace_id !== ctx.workspace.id) notFound();

  const [folder, allBoxNotes, links, historyResult, generatingConnection] =
    await Promise.all([
      note.folder_id
        ? getFolderById(supabase, note.folder_id)
        : Promise.resolve(null),
      listNotesByBox(supabase, note.box_id, { branchId: ctx.activeBranchId }),
      listLinksForNote(supabase, note_id),
      listVersionsForNote(adminClient, ctx.workspace.id, note_id, {
        limit: 100,
      }),
      note.is_generated && note.generated_by_connection_id
        ? getConnectionById(adminClient, note.generated_by_connection_id).catch(
            () => null
          )
        : Promise.resolve(null),
    ]);

  const initialBundle = await assembleContextBundle(
    supabase,
    ctx.workspace.id,
    note_id
  );

  await auditBundleRead(supabase, ctx.workspace.id, ctx.user!.id, note_id, {
    box_id: box.id,
    linked_count: initialBundle.linked_notes.length,
    guide_included: initialBundle.guide_note !== null,
    ancestor_summary_included: initialBundle.ancestor_summary_note !== null,
    truncated: initialBundle.truncated,
  });

  const isGuideNote = box.guide_note_id === note_id;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ActiveBranchBannerServer objectType="note" objectId={note_id} />
      <div className="flex flex-1 overflow-hidden">
      <WorkspaceLiveRefresh
        workspaceId={ctx.workspace.id}
        scope="object"
        objectType="note"
        objectId={note_id}
        protectWhileEditing
      />
      {/* Center — note editor */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top bar: breadcrumb + badges + actions */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <Breadcrumb
              workspaceName={ctx.workspace.name}
              boxId={box.id}
              boxName={box.name}
              folderName={folder?.name ?? null}
              noteTitle={note.title}
            />
            {isGuideNote && (
              <Badge
                variant="secondary"
                className="flex shrink-0 items-center gap-1 border-amber-300/60 bg-amber-50/60 text-[10px] font-normal text-amber-700 dark:border-amber-600/40 dark:bg-amber-900/20 dark:text-amber-400"
              >
                <BookOpen className="h-3 w-3" aria-hidden="true" />
                Guide
              </Badge>
            )}
            {note.is_generated && (
              <Badge
                variant="outline"
                className="flex shrink-0 items-center gap-1 text-[10px] font-normal"
              >
                <Bot className="h-3 w-3" aria-hidden="true" />
                Generated
              </Badge>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Version history — opens the History tab in the context panel */}
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
            <NoteLifecycleMenu
              noteId={note_id}
              noteStatus={
                note.status as "draft" | "active" | "archived" | "trashed"
              }
            />
            <NoteImportButton noteId={note_id} noteTitle={note.title} />
            <NoteExportMenu noteId={note_id} noteTitle={note.title} />
          </div>
        </div>

        {/* Mobile metadata strip — visible only on small screens where right panel is hidden */}
        {(note.kind !== "note" || note.status === "archived" || note.status === "trashed" || note.tags.length > 0) && (
          <div className="flex items-center gap-2 flex-wrap border-b border-border px-6 py-1.5 lg:hidden">
            {note.kind !== "note" && (
              <Badge
                variant="secondary"
                className={cn(
                  "text-[10px] font-normal capitalize",
                  note.kind === "guide" && "border-amber-300/60 bg-amber-50/60 text-amber-700 dark:border-amber-600/40 dark:bg-amber-900/20 dark:text-amber-400"
                )}
              >
                {note.kind}
              </Badge>
            )}
            {note.status === "archived" && (
              <Badge variant="secondary" className="flex items-center gap-1 text-[10px] font-normal">
                <Archive className="h-2.5 w-2.5" aria-hidden="true" />
                Archived
              </Badge>
            )}
            {note.status === "trashed" && (
              <Badge variant="secondary" className="flex items-center gap-1 text-[10px] font-normal text-destructive">
                <Trash2 className="h-2.5 w-2.5" aria-hidden="true" />
                Trash
              </Badge>
            )}
            {note.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] font-normal">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Generated note banner */}
        {note.is_generated && (
          <GeneratedNoteBanner
            noteId={note_id}
            connectionName={generatingConnection?.name ?? null}
          />
        )}

        {/* Note editor — fills remaining space */}
        <div className="flex-1 overflow-hidden">
          <NoteEditor note={note} initialMode="document" />
        </div>
      </div>

      {/* Right panel — note context */}
      <aside
        aria-label="Note context panel"
        className="hidden lg:flex lg:h-full lg:w-72 lg:shrink-0 lg:flex-col lg:border-l lg:border-border lg:bg-background"
      >
        <NoteContextPanel
          note={note}
          boxId={box.id}
          boxName={box.name}
          folderName={folder?.name ?? null}
          workspaceName={ctx.workspace.name}
          isGuideNote={isGuideNote}
          generatingConnectionName={generatingConnection?.name ?? null}
          links={links}
          allBoxNotes={allBoxNotes}
          initialBundle={initialBundle}
          historyResult={historyResult}
          defaultTab={defaultTab}
        />
      </aside>
      </div>
    </div>
  );
}
