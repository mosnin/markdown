import { notFound } from "next/navigation";
import { BookOpen, Bot, ChevronRight, Clock, GitBranch } from "lucide-react";
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
import { NoteLifecycleMenu } from "@/components/product/note_lifecycle_menu";
import { GeneratedNoteBanner } from "@/components/product/generated_note_banner";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
}: {
  workspaceName: string;
  boxId: string;
  boxName: string;
  folderName: string | null;
}) {
  const parts = [
    { label: workspaceName, href: "/app" },
    { label: boxName, href: `/app/boxes/${boxId}` },
    ...(folderName ? [{ label: folderName, href: null }] : []),
  ];

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
      {parts.map((part, i) => (
        <span key={part.label} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />}
          {part.href ? (
            <Link
              href={part.href}
              className="hover:text-foreground hover:underline underline-offset-2 transition-fast"
            >
              {part.label}
            </Link>
          ) : (
            <span>{part.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

// ─── Right panel — Note context ───────────────────────────────────────────────

function NoteContextPanel({
  note,
  boxId,
  boxName,
  folderName,
  workspaceName,
  isGuideNote,
  links,
  allBoxNotes,
  initialBundle,
  historyResult,
}: {
  note: NonNullable<Awaited<ReturnType<typeof getNoteById>>>;
  boxId: string;
  boxName: string;
  folderName: string | null;
  workspaceName: string;
  isGuideNote: boolean;
  links: { outgoing: Awaited<ReturnType<typeof listLinksForNote>>["outgoing"]; incoming: Awaited<ReturnType<typeof listLinksForNote>>["incoming"] };
  allBoxNotes: Awaited<ReturnType<typeof listNotesByBox>>;
  initialBundle: Awaited<ReturnType<typeof assembleContextBundle>>;
  historyResult: Awaited<ReturnType<typeof listVersionsForNote>>;
}) {
  const kindLabel: Record<string, string> = {
    note: "Note",
    guide: "Guide",
    bundle: "Bundle",
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Panel header */}
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Note context
        </p>
      </div>

      {/* Tabs: Info | Bundle | History */}
      <Tabs defaultValue="info" className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border px-4">
          <TabsList variant="line" className="h-auto pb-0">
            <TabsTrigger value="info" className="pb-2.5 text-xs">
              Info
            </TabsTrigger>
            <TabsTrigger value="links" className="pb-2.5 text-xs">
              Links
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
            {/* Kind + Guide status */}
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  {kindLabel[note.kind] ?? note.kind}
                </span>
                {isGuideNote && (
                  <Badge
                    variant="secondary"
                    className="flex items-center gap-1 text-[10px] font-normal"
                  >
                    <BookOpen className="h-3 w-3" aria-hidden="true" />
                    Box guide
                  </Badge>
                )}
              </div>
              <p className="mt-1 line-clamp-3 text-sm font-medium text-foreground">
                {note.title}
              </p>
            </div>

            {/* Tags */}
            {note.tags.length > 0 && (
              <div className="border-b border-border px-4 py-3">
                <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  Tags
                </p>
                <div className="flex flex-wrap gap-1">
                  {note.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs font-normal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Location */}
            <div className="border-b border-border px-4 py-3">
              <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Location
              </p>
              <div className="flex flex-col gap-1.5 text-xs">
                <MetaField label="Workspace" value={workspaceName} />
                <MetaField
                  label="Box"
                  value={boxName}
                  href={`/app/boxes/${boxId}`}
                />
                {folderName && <MetaField label="Folder" value={folderName} />}
              </div>
            </div>

            {/* Version */}
            <div className="border-b border-border px-4 py-3">
              <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Version
              </p>
              <div className="flex flex-col gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  <span className="font-mono text-[11px] text-foreground/70">
                    {note.current_version_id
                      ? note.current_version_id.slice(0, 8) + "…"
                      : "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  <span className="text-foreground/70">
                    {formatRelativeDate(note.updated_at)}
                  </span>
                </div>
              </div>
            </div>

            {/* Summary */}
            {note.summary && (
              <div className="border-b border-border px-4 py-3">
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  Summary
                </p>
                <p className="text-xs leading-relaxed text-foreground/80">
                  {note.summary}
                </p>
              </div>
            )}

            {/* Read hint */}
            {note.read_hint && (
              <div className="px-4 py-3">
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  Read hint
                </p>
                <p className="text-xs italic leading-relaxed text-muted-foreground">
                  {note.read_hint}
                </p>
              </div>
            )}
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
            <div className="px-3 py-3">
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

function MetaField({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
        {label}
      </p>
      {href ? (
        <Link
          href={href}
          className="text-foreground/80 hover:text-foreground hover:underline underline-offset-2 transition-fast"
        >
          {value}
        </Link>
      ) : (
        <p className="text-foreground/80">{value}</p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function NotePage({
  params,
}: {
  params: Promise<{ note_id: string }>;
}) {
  const { note_id } = await params;
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
      listNotesByBox(supabase, note.box_id),
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
    <div className="flex h-full overflow-hidden">
      {/* Center — note editor */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top bar: breadcrumb + actions */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <Breadcrumb
              workspaceName={ctx.workspace.name}
              boxId={box.id}
              boxName={box.name}
              folderName={folder?.name ?? null}
            />
            {isGuideNote && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1 text-[10px] font-normal shrink-0"
              >
                <BookOpen className="h-3 w-3" aria-hidden="true" />
                Guide
              </Badge>
            )}
            {note.is_generated && (
              <Badge
                variant="outline"
                className="flex items-center gap-1 text-[10px] font-normal shrink-0"
              >
                <Bot className="h-3 w-3" aria-hidden="true" />
                Generated
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <NoteLifecycleMenu
              noteId={note_id}
              noteStatus={
                note.status as "draft" | "active" | "archived" | "trashed"
              }
            />
            <NoteExportMenu noteId={note_id} noteTitle={note.title} />
          </div>
        </div>

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
          links={links}
          allBoxNotes={allBoxNotes}
          initialBundle={initialBundle}
          historyResult={historyResult}
        />
      </aside>
    </div>
  );
}
