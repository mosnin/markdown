import { notFound } from "next/navigation";
import { after } from "next/server";
import dynamic from "next/dynamic";
import {
  Archive,
  BookOpen,
  Bot,
  ChevronRight,
  Clock,
  GitBranch,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNoteById, listNotesByBox } from "@/server/repositories/note_repository";
import { getFolderById } from "@/server/repositories/folder_repository";
import { getConnectionById } from "@/server/repositories/connection_repository";
import { listLinksForNote } from "@/server/services/link_service";
import { listNoteComments, countUnresolvedComments } from "@/server/services/note_comment_service";
import { assembleContextBundle } from "@/server/services/context_bundle_service";
import { listMentionsByNote } from "@/server/repositories/entity_mention_repository";
import { getEntityById } from "@/server/repositories/entity_repository";
import {
  getCachedNoteById,
  getCachedBoxById,
  getCachedContextBundle,
} from "@/server/services/cached_reads";
import { auditBundleRead } from "@/server/services/audit_service";
import { listVersionsForNote } from "@/server/services/version_history_service";
import { listPendingProposalsForNote } from "@/server/repositories/write_proposal_repository";
import { NoteEditor } from "@/components/product/notes/note_editor";
import { NoteAiCopilotTab, type PendingProposalRef } from "@/components/product/notes/note_ai_copilot_tab";
import { type AiTimelineEntry } from "@/components/product/notes/note_ai_timeline";
import { NoteCommentsPanel } from "@/components/product/notes/note_comments_panel";
import { NoteEntitiesPanel } from "@/components/product/notes/note_entities_panel";
import { NoteBacklinksPanel } from "@/components/product/notes/note_backlinks_panel";
import { CopyFrontmatterButton } from "@/components/product/notes/copy_frontmatter_button";
import type { EntityChipType } from "@/components/product/entity_chip";
import { GeneratedNoteBanner } from "@/components/product/generated_note_banner";
import { NoteAiReadinessBadge } from "@/components/product/notes/note_ai_readiness_badge";
import { NoteMetadataChecklist } from "@/components/product/notes/note_metadata_checklist";
import { NoteBundleExportButton } from "@/components/product/notes/note_bundle_export_button";
import { RetrievalPrioritySlider, ReadHintSelector } from "@/components/product/notes/note_retrieval_editor";
import { NoteActionBar } from "@/components/product/notes/note_action_bar";
import { NoteContextTabs } from "@/components/product/notes/note_context_tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { WorkspaceLiveRefresh } from "@/components/product/workspace/workspace_live_refresh";

// Secondary-tab panels are code-split so they're not in the note's initial JS
// bundle — they load only when their (non-default) tab is opened. The default
// "ai" tab (NoteAiCopilotTab) and the editor stay eager.
const SemanticLinksPanel = dynamic(() =>
  import("@/components/product/semantic_links_panel").then((m) => ({ default: m.SemanticLinksPanel })),
);
const LinkSuggestionsPanel = dynamic(() =>
  import("@/components/product/link_suggestions_panel").then((m) => ({ default: m.LinkSuggestionsPanel })),
);
const ContextBundleViewer = dynamic(() =>
  import("@/components/product/context_bundle_viewer").then((m) => ({ default: m.ContextBundleViewer })),
);
const NoteHistoryPanel = dynamic(() =>
  import("@/components/product/notes/note_history_panel").then((m) => ({ default: m.NoteHistoryPanel })),
);
import { ActiveBranchBannerServer } from "@/components/product/active_branch_banner_server";
import { formatRelativeDate } from "@/lib/format_date";

// ─── Shared tokens ──────────────────────────────────────────────────────────
//
// The app's NEW aesthetic (see boxes_bento / floating_shell / spotlight_card):
// soft rounded `bg-card` surfaces, a single quiet shadow, no hard borders.

const SOFT_SHADOW =
  "shadow-[0_2px_12px_-2px_rgba(0,0,0,0.07),0_1px_4px_-1px_rgba(0,0,0,0.05)]";
const SECTION_LABEL =
  "text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground";

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
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {parts.map((part, i) => (
        <span key={`${part.label}-${i}`} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />}
          {part.href ? (
            <Link
              href={part.href}
              className="rounded-md transition-fast hover:text-foreground"
            >
              {part.label}
            </Link>
          ) : i === parts.length - 1 ? (
            /* Current page — note title shown with stronger contrast */
            <span className="max-w-[200px] truncate font-medium text-foreground/80" title={part.label}>
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

// ─── Right-panel building blocks ────────────────────────────────────────────

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

/** A soft, collapsible group for the "History" tab (replaces sharp <details>). */
function PanelDisclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group rounded-2xl bg-card transition-shadow open:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.07),0_1px_4px_-1px_rgba(0,0,0,0.05)]" open={defaultOpen}>
      <summary
        className={cn(
          "flex cursor-pointer select-none items-center justify-between rounded-2xl px-4 py-3 text-xs font-medium text-foreground transition-fast",
          "hover:bg-accent/50 group-open:rounded-b-none"
        )}
      >
        {summary}
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-border/50">{children}</div>
    </details>
  );
}

// ─── Right panel — Note context ───────────────────────────────────────────────

const VALID_TABS = ["context", "ai", "more"] as const;
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
  commentThreads,
  unresolvedCommentCount,
  currentUserId,
  noteEntities,
  defaultTab = "context",
  markdownContent,
  aiTimelineEntries,
  pendingProposals,
  nowIso,
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
  commentThreads: Awaited<ReturnType<typeof listNoteComments>>;
  unresolvedCommentCount: number;
  currentUserId: string;
  noteEntities: React.ComponentProps<typeof NoteEntitiesPanel>["entities"];
  defaultTab?: NoteContextTab;
  /** Raw markdown content of the current note — passed through to NoteBacklinksPanel. */
  markdownContent: string;
  aiTimelineEntries: AiTimelineEntry[];
  pendingProposals: PendingProposalRef[];
  /**
   * Wall-clock "now" frozen at the top of the server render so
   * `formatRelativeDate` produces identical output during server
   * render and client hydration. Without this, server and client
   * would each call `new Date()` at different ticks and could
   * straddle a day boundary, triggering a hydration mismatch.
   */
  nowIso: string;
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

  const linkCount = links.outgoing.length + links.incoming.length;

  // ── Context tab — About / Retrieval / Links / Backlinks ──
  const contextPanel = (
    <ScrollArea className="h-full">
      <div className="space-y-4 px-4 pb-6">
        {/* Guide note callout — shown prominently when this IS the guide */}
        {isGuideNote && (
          <div className="rounded-2xl border border-amber-300/50 bg-amber-50/50 px-4 py-3 dark:border-amber-600/30 dark:bg-amber-900/10">
            <div className="flex items-center gap-2">
              <BookOpen
                className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500"
                aria-hidden="true"
              />
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                This is the guide note for{" "}
                <Link
                  href={`/app/boxes/${boxId}`}
                  className="underline underline-offset-2 transition-fast hover:text-amber-800 dark:hover:text-amber-300"
                >
                  {boxName}
                </Link>
              </p>
            </div>
            <p className="mt-1 pl-5 text-[11px] text-amber-700/70 dark:text-amber-400/70">
              AI agents read this note first when assembling context for this box.
            </p>
          </div>
        )}

        {/* About card */}
        <PanelCard>
          {/* Identity */}
          <InfoSection>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              {note.kind === "guide" ? (
                <Badge
                  variant="secondary"
                  className="flex items-center gap-1 rounded-full border-amber-300/60 bg-amber-50/60 text-[10px] font-normal text-amber-700 dark:border-amber-600/40 dark:bg-amber-900/20 dark:text-amber-400"
                >
                  <BookOpen className="h-2.5 w-2.5" aria-hidden="true" />
                  Guide note
                </Badge>
              ) : note.kind !== "note" ? (
                <Badge variant="secondary" className="rounded-full text-[10px] font-normal capitalize">
                  {kindLabel[note.kind] ?? note.kind}
                </Badge>
              ) : null}
              <NoteAiReadinessBadge
                summary={note.summary}
                tags={note.tags}
                linkCount={linkCount}
                readHint={note.read_hint}
                retrievalPriority={note.retrieval_priority}
              />
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

          {/* Retrieval signals — interactive editors */}
          <InfoSection>
            <InfoLabel>Retrieval</InfoLabel>
            <div className="flex flex-col gap-4">
              <RetrievalPrioritySlider
                noteId={note.id}
                initialPriority={note.retrieval_priority}
              />
              <ReadHintSelector noteId={note.id} initialReadHint={note.read_hint} />
            </div>
          </InfoSection>

          {/* AI Context Checklist */}
          <InfoSection>
            <NoteMetadataChecklist
              summary={note.summary}
              tags={note.tags}
              linkCount={linkCount}
              readHint={note.read_hint}
              retrievalPriority={note.retrieval_priority}
            />
          </InfoSection>

          {/* Tags */}
          {note.tags.length > 0 && (
            <InfoSection>
              <InfoLabel>Tags</InfoLabel>
              <div className="flex flex-wrap gap-1.5">
                {note.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="rounded-full text-xs font-normal">
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
              className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
            >
              <Link
                href="/app"
                className="transition-fast hover:text-foreground"
              >
                {workspaceName}
              </Link>
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />
              <Link
                href={`/app/boxes/${boxId}`}
                className="transition-fast hover:text-foreground"
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
                  Promote this note to take ownership. Provenance and history are
                  preserved.
                </p>
              </div>
            </InfoSection>
          )}

          {/* Entities */}
          <InfoSection>
            <NoteEntitiesPanel entities={noteEntities} />
          </InfoSection>

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
                  {formatRelativeDate(note.updated_at, nowIso)}
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
        </PanelCard>

        {/* Links card */}
        <PanelCard>
          <div className="px-4 pb-1 pt-3.5">
            <p className={SECTION_LABEL}>Links</p>
          </div>
          <div className="px-4 py-3">
            <SemanticLinksPanel
              sourceNoteId={note.id}
              outgoing={links.outgoing}
              incoming={links.incoming}
              allBoxNotes={allBoxNotes}
            />
          </div>
          <div className="border-t border-border/50 px-4 py-3">
            <LinkSuggestionsPanel noteId={note.id} />
          </div>
          {links.outgoing.length > 0 && (
            <div className="border-t border-border/50 px-4 py-3">
              <CopyFrontmatterButton
                outgoing={links.outgoing}
                allBoxNotes={allBoxNotes}
              />
            </div>
          )}
        </PanelCard>

        {/* Backlinks card */}
        <PanelCard>
          <div className="px-4 pb-1 pt-3.5">
            <p className={SECTION_LABEL}>Backlinks</p>
          </div>
          <div className="px-4 py-3">
            <NoteBacklinksPanel
              noteId={note.id}
              incoming={links.incoming}
              allBoxNotes={allBoxNotes}
              markdownContent={markdownContent}
            />
          </div>
        </PanelCard>
      </div>
    </ScrollArea>
  );

  // ── AI copilot tab ──
  // NoteAiCopilotTab owns its own <ScrollArea> (h-full), so we frame it in a
  // full-height card rather than nesting a second scroll container.
  const aiPanel = (
    <div className="h-full px-4 pb-4">
      <PanelCard className="h-full overflow-hidden">
        <NoteAiCopilotTab
          noteId={note.id}
          noteTitle={note.title}
          aiTimelineEntries={aiTimelineEntries}
          pendingProposals={pendingProposals}
        />
      </PanelCard>
    </div>
  );

  // ── More tab (Bundle + History + Comments) ──
  const morePanel = (
    <ScrollArea className="h-full">
      <div className="space-y-3 px-4 pb-6">
        <PanelDisclosure summary="Bundle & Export">
          <div className="space-y-4 px-4 py-3">
            <NoteBundleExportButton
              noteId={note.id}
              noteTitle={note.title}
              noteSlug={note.slug}
            />
            <ContextBundleViewer initialBundle={initialBundle} noteId={note.id} />
          </div>
        </PanelDisclosure>

        <PanelDisclosure summary="Version history">
          <NoteHistoryPanel
            noteId={note.id}
            initialVersions={historyResult.versions}
            currentVersionId={historyResult.current_version_id}
          />
        </PanelDisclosure>

        <PanelDisclosure
          summary={
            <span className="flex items-center gap-1.5">
              Comments
              {unresolvedCommentCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] text-muted-foreground">
                  {unresolvedCommentCount}
                </span>
              )}
            </span>
          }
        >
          <NoteCommentsPanel
            noteId={note.id}
            threads={commentThreads}
            currentUserId={currentUserId}
          />
        </PanelDisclosure>
      </div>
    </ScrollArea>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Panel header */}
      <div className="shrink-0 px-4 pb-3 pt-4">
        <p className={SECTION_LABEL}>Note context</p>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <NoteContextTabs
          defaultTab={defaultTab}
          pendingProposalsCount={pendingProposals.length}
          contextPanel={contextPanel}
          aiPanel={aiPanel}
          morePanel={morePanel}
        />
      </div>
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
  const rawTab = typeof resolvedSearch.tab === "string" ? resolvedSearch.tab : "ai";
  const defaultTab: NoteContextTab = VALID_TABS.includes(rawTab as NoteContextTab)
    ? (rawTab as NoteContextTab)
    : "ai";
  // Freeze "now" at server render start. React hydrates the client
  // with exactly this string (embedded in the server HTML via the
  // `nowIso` prop), so relative-date computation produces identical
  // output on both sides and hydration passes. See
  // src/lib/format_date.ts.
  const nowIso = new Date().toISOString();
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const note = await getCachedNoteById(supabase, note_id);
  if (!note) notFound();

  const box = await getCachedBoxById(supabase, note.box_id);
  if (!box || box.workspace_id !== ctx.workspace.id) notFound();

  const [folder, allBoxNotes, links, historyResult, generatingConnection, commentThreads, unresolvedCommentCount, mentions, notePendingProposals] =
    await Promise.all([
      note.folder_id
        ? getFolderById(supabase, note.folder_id)
        : Promise.resolve(null),
      listNotesByBox(supabase, note.box_id, { branchId: ctx.activeBranchId }),
      listLinksForNote(supabase, note_id, { branchId: ctx.activeBranchId }),
      listVersionsForNote(adminClient, ctx.workspace.id, note_id, {
        limit: 100,
      }),
      note.is_generated && note.generated_by_connection_id
        ? getConnectionById(adminClient, note.generated_by_connection_id).catch(
            () => null
          )
        : Promise.resolve(null),
      listNoteComments(supabase, note_id),
      countUnresolvedComments(supabase, note_id),
      listMentionsByNote(supabase, note_id),
      listPendingProposalsForNote(supabase, ctx.workspace.id, note_id),
    ]);

  // Resolve entities referenced by this note's mentions. An entity can be
  // mentioned multiple times in the same note; we dedupe by entity id so the
  // sidebar lists each entity once, with its global mention_count.
  const uniqueEntityIds = [...new Set(mentions.map((m) => m.entity_id))];
  const entityRows = await Promise.all(
    uniqueEntityIds.map((id) => getEntityById(supabase, id))
  );
  const entityMap = new Map(
    entityRows.filter((e): e is NonNullable<typeof e> => e !== null).map((e) => [e.id, e])
  );
  const noteEntities = Array.from(
    new Map(
      mentions
        .filter((m) => entityMap.has(m.entity_id))
        .map((m) => {
          const e = entityMap.get(m.entity_id)!;
          return [
            e.id,
            {
              id: e.id,
              name: e.name,
              entity_type: e.entity_type as EntityChipType,
              mention_count: e.mention_count,
              surface_form: m.surface_form,
              context: m.context,
            },
          ] as const;
        })
    ).values()
  );

  const initialBundle = await getCachedContextBundle(
    supabase,
    ctx.workspace.id,
    note_id
  );

  // Audit the bundle read OFF the critical path. It's a fire-and-forget write
  // that must not add a DB round-trip to every note open; failure is non-critical.
  after(() =>
    auditBundleRead(supabase, ctx.workspace.id, ctx.user!.id, note_id, {
      box_id: box.id,
      linked_count: initialBundle.linked_notes.length,
      guide_included: initialBundle.guide_note !== null,
      ancestor_summary_included: initialBundle.ancestor_summary_note !== null,
      truncated: initialBundle.truncated,
    }).catch(() => {}),
  );

  const isGuideNote = box.guide_note_id === note_id;

  // Derive a short display name for presence avatars — same logic as
  // the branch detail page: strip the domain from the email, or fall
  // back to a truncated user ID.
  const aiTimelineEntries: AiTimelineEntry[] = historyResult.versions.filter(
    (v) => v.change_origin === "generated" || v.change_origin === "proposal_approved"
  );

  const pendingProposals: PendingProposalRef[] = notePendingProposals.map((p) => ({
    id: p.id,
    type: p.proposal_type,
    connectionName: null,
    createdAt: p.created_at,
  }));

  const userEmail = ctx.user.email ?? null;
  const currentUserDisplayName =
    userEmail && userEmail.includes("@")
      ? userEmail.split("@")[0]
      : userEmail ?? ctx.user.id;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <ActiveBranchBannerServer objectType="note" objectId={note_id} />
      <div className="flex flex-1 overflow-hidden">
        <WorkspaceLiveRefresh
          workspaceId={ctx.workspace.id}
          scope="object"
          objectType="note"
          objectId={note_id}
          protectWhileEditing
        />

        {/* Center — note editor column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* ── Header: breadcrumb + title label + actions ── */}
          <div className="shrink-0 px-4 pt-5 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Breadcrumb
                  workspaceName={ctx.workspace.name}
                  boxId={box.id}
                  boxName={box.name}
                  folderName={folder?.name ?? null}
                  noteTitle={note.title}
                />
                <div className="flex items-center gap-2">
                  <p className={SECTION_LABEL}>Note</p>
                  {isGuideNote && (
                    <Badge
                      variant="secondary"
                      className="flex shrink-0 items-center gap-1 rounded-full border-amber-300/60 bg-amber-50/60 text-[10px] font-normal text-amber-700 dark:border-amber-600/40 dark:bg-amber-900/20 dark:text-amber-400"
                    >
                      <BookOpen className="h-3 w-3" aria-hidden="true" />
                      Guide
                    </Badge>
                  )}
                  {note.is_generated && (
                    <Badge
                      variant="outline"
                      className="flex shrink-0 items-center gap-1 rounded-full text-[10px] font-normal"
                    >
                      <Bot className="h-3 w-3" aria-hidden="true" />
                      Generated
                    </Badge>
                  )}
                </div>
              </div>

              <NoteActionBar
                noteId={note_id}
                noteTitle={note.title}
                noteStatus={
                  note.status as "draft" | "active" | "archived" | "trashed"
                }
              />
            </div>
          </div>

          {/* Mobile metadata strip — visible only on small screens where right panel is hidden */}
          {(note.kind !== "note" || note.status === "archived" || note.status === "trashed" || note.tags.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3 sm:px-6 lg:hidden">
              {note.kind !== "note" && (
                <Badge
                  variant="secondary"
                  className={cn(
                    "rounded-full text-[10px] font-normal capitalize",
                    note.kind === "guide" && "border-amber-300/60 bg-amber-50/60 text-amber-700 dark:border-amber-600/40 dark:bg-amber-900/20 dark:text-amber-400"
                  )}
                >
                  {note.kind}
                </Badge>
              )}
              {note.status === "archived" && (
                <Badge variant="secondary" className="flex items-center gap-1 rounded-full text-[10px] font-normal">
                  <Archive className="h-2.5 w-2.5" aria-hidden="true" />
                  Archived
                </Badge>
              )}
              {note.status === "trashed" && (
                <Badge variant="secondary" className="flex items-center gap-1 rounded-full text-[10px] font-normal text-destructive">
                  <Trash2 className="h-2.5 w-2.5" aria-hidden="true" />
                  Trash
                </Badge>
              )}
              {note.tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="secondary" className="rounded-full text-[10px] font-normal">
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

          {/* ── Editor frame — soft rounded card, generous breathing room ── */}
          <div className="min-h-0 flex-1 px-4 pb-4 pt-4 sm:px-6 sm:pb-6 lg:px-8">
            <div className={cn("h-full overflow-hidden rounded-3xl bg-card", SOFT_SHADOW)}>
              <NoteEditor
                note={note}
                initialMode="document"
                currentUser={{
                  userId: ctx.user.id,
                  displayName: currentUserDisplayName,
                }}
                workspaceId={ctx.workspace.id}
              />
            </div>
          </div>
        </div>

        {/* Right panel — note context */}
        <aside
          aria-label="Note context panel"
          className="hidden lg:flex lg:h-full lg:w-[22rem] lg:shrink-0 lg:flex-col lg:overflow-hidden lg:pr-4"
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
            commentThreads={commentThreads}
            unresolvedCommentCount={unresolvedCommentCount}
            currentUserId={ctx.user!.id}
            noteEntities={noteEntities}
            defaultTab={defaultTab}
            markdownContent={note.markdown_content}
            aiTimelineEntries={aiTimelineEntries}
            pendingProposals={pendingProposals}
            nowIso={nowIso}
          />
        </aside>
      </div>
    </div>
  );
}
