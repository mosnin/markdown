import { notFound } from "next/navigation";
import { Bot, FileText, Folder } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getBoxById } from "@/server/repositories/box_repository";
import { listFoldersByBox } from "@/server/repositories/folder_repository";
import { listNotesByBox, getNoteById } from "@/server/repositories/note_repository";
import { listLinksFromNote } from "@/server/repositories/note_link_repository";
import { getBoxOverview } from "@/server/services/overview_service";
import { PageHeader } from "@/components/product/page_header";
import { PanelSection } from "@/components/product/panel_section";
import { EmptyState } from "@/components/product/empty_state";
import { BoxContentsTree } from "@/components/product/box_contents_tree";
import { BoxGuidePanel } from "@/components/product/box_guide_panel";
import { BoxOverviewPanel } from "@/components/product/box_overview_panel";
import { BoxSearchPanel } from "@/components/product/box_search_panel";
import { CreateFolderDialog } from "@/components/product/create_folder_dialog";
import { CreateNoteDialog } from "@/components/product/create_note_dialog";
import { GuideNotePicker } from "@/components/product/guide_note_picker";
import { NoteStub } from "@/components/product/note_stub";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type NoteLink } from "@/server/domain/types/note_link";
import { BoxExportMenu } from "@/components/product/export_menu";
import { ImportTriggerButton } from "@/components/product/import_dialog";
import { FolderPolicyToggle } from "@/components/product/folder_policy_toggle";
import Link from "next/link";

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

// ─── Right panel ──────────────────────────────────────────────────────────────

async function BoxPanel({
  box,
  guideNote,
  notes,
  folders,
  folderCount,
  noteCount,
}: {
  box: Awaited<ReturnType<typeof getBoxById>>;
  guideNote: Awaited<ReturnType<typeof getNoteById>>;
  notes: Awaited<ReturnType<typeof listNotesByBox>>;
  folders: Awaited<ReturnType<typeof listFoldersByBox>>;
  folderCount: number;
  noteCount: number;
}) {
  if (!box) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Box overview
        </p>
      </div>
      <ScrollArea className="flex-1">
        {/* Identity */}
        <div className="border-b border-border px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            box
          </p>
          <p className="mt-0.5 text-sm font-medium text-foreground">{box.name}</p>
          {box.description && (
            <p className="mt-1 text-xs text-muted-foreground">{box.description}</p>
          )}
        </div>

        {/* Guide note */}
        <PanelSection title="Guide note" noSeparator>
          <GuideNotePicker
            boxId={box.id}
            currentGuideNote={guideNote ?? null}
            notes={notes}
          />
        </PanelSection>

        <Separator />

        {/* Stats */}
        <PanelSection title="Contents" noSeparator>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <div className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-1.5">
                <Folder className="h-3 w-3" />
                <span>Folders</span>
              </div>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                {folderCount}
              </Badge>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3 w-3" />
                <span>Notes</span>
              </div>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                {noteCount}
              </Badge>
            </div>
          </div>
        </PanelSection>

        {/* Folder generated-note policies */}
        {folders.length > 0 && (
          <>
            <Separator />
            <PanelSection title="Folder policies" noSeparator>
              <div className="flex flex-col gap-1">
                <p className="text-[10px] text-muted-foreground/70 mb-1">
                  Folders that accept AI-generated notes
                </p>
                {folders.map((folder) => (
                  <div
                    key={folder.id}
                    className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Folder className="h-3 w-3 shrink-0 text-muted-foreground/60" />
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

        {/* Metadata */}
        <PanelSection title="Details" noSeparator>
          <div className="flex flex-col gap-2 text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Created
              </p>
              <p className="text-foreground/80">{formatDate(box.created_at)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Updated
              </p>
              <p className="text-foreground/80">{formatDate(box.updated_at)}</p>
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

export default async function BoxPage({
  params,
}: {
  params: Promise<{ box_id: string }>;
}) {
  const { box_id } = await params;
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  // Load box and verify ownership
  const box = await getBoxById(supabase, box_id);
  if (!box || box.workspace_id !== ctx.workspace.id) {
    notFound();
  }

  // Load contents
  const [folders, notes] = await Promise.all([
    listFoldersByBox(supabase, box.id),
    listNotesByBox(supabase, box.id),
  ]);

  // Load guide note if assigned
  const guideNote = box.guide_note_id
    ? await getNoteById(supabase, box.guide_note_id)
    : null;

  // Load all links for all notes in this box (for guide panel)
  const linkArrays = await Promise.all(
    notes.map((n) => listLinksFromNote(supabase, n.id))
  );
  const allLinks: NoteLink[] = linkArrays.flat();

  // Build overview
  const overview = await getBoxOverview(supabase, box);

  const sortedNotes = [...notes].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <PageHeader
          eyebrow={ctx.workspace.name}
          title={box.name}
          description={box.description ?? undefined}
          actions={
            <div className="flex items-center gap-2">
              <ImportTriggerButton
                boxId={box.id}
                folders={folders.map((f) => ({
                  id: f.id,
                  name: f.name,
                  path_cache: f.path_cache,
                }))}
              />
              <BoxExportMenu boxId={box.id} boxName={box.name} />
              <CreateFolderDialog boxId={box.id} />
              <CreateNoteDialog boxId={box.id} folders={folders} />
            </div>
          }
        />

        <Tabs defaultValue="notes" className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-border px-6">
            <TabsList variant="line" className="h-auto pb-0">
              <TabsTrigger value="notes" className="pb-3">
                Notes
              </TabsTrigger>
              <TabsTrigger value="tree" className="pb-3">
                Tree
              </TabsTrigger>
              <TabsTrigger value="guide" className="pb-3">
                Guide
              </TabsTrigger>
              <TabsTrigger value="overview" className="pb-3">
                Overview
              </TabsTrigger>
              <TabsTrigger value="search" className="pb-3">
                Search
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ── Notes tab ── */}
          <TabsContent value="notes" className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              {sortedNotes.length === 0 ? (
                <EmptyState
                  icon={<FileText className="h-5 w-5" />}
                  title="No notes yet"
                  description="Create a note to start capturing context in this box."
                  action={<CreateNoteDialog boxId={box.id} folders={folders} />}
                  className="h-full"
                />
              ) : (
                <div className="mx-auto max-w-3xl flex flex-col gap-2 px-6 py-4">
                  {sortedNotes.map((note) => (
                    <Link key={note.id} href={`/app/notes/${note.id}`} className="block">
                      <NoteStub
                        title={note.title}
                        kind={note.kind as "note" | "guide" | "bundle"}
                        excerpt={note.summary ?? undefined}
                        updatedAt={formatRelativeDate(note.updated_at)}
                        tags={note.tags.slice(0, 3)}
                      />
                    </Link>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* ── Tree tab ── */}
          <TabsContent value="tree" className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="mx-auto max-w-3xl px-6 py-4">
                <BoxContentsTree folders={folders} notes={notes} />
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
                />
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── Overview tab ── */}
          <TabsContent value="overview" className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="mx-auto max-w-3xl px-6 py-6">
                <BoxOverviewPanel overview={overview} />
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── Search tab ── */}
          <TabsContent value="search" className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="mx-auto max-w-2xl px-6 py-6">
                <BoxSearchPanel boxId={box.id} />
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>

      {/* Right panel */}
      <aside className="hidden lg:flex lg:h-full lg:w-72 lg:shrink-0 lg:flex-col lg:border-l lg:border-border lg:bg-background">
        <BoxPanel
          box={box}
          guideNote={guideNote}
          notes={notes}
          folders={folders}
          folderCount={folders.length}
          noteCount={notes.length}
        />
      </aside>
    </div>
  );
}
