import { BookOpen, FileText, Folder, Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/product/page_header";
import { NoteStub } from "@/components/product/note_stub";
import { TreeStub, type TreeNode } from "@/components/product/tree_stub";
import { EmptyState } from "@/components/product/empty_state";
import { MetadataPanelStub } from "@/components/product/metadata_panel_stub";
import { AppShell } from "@/components/product/app_shell";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PanelSection } from "@/components/product/panel_section";

// ─── Stub data ───────────────────────────────────────────────────────────────

const stubBox = {
  id: "box-1",
  name: "Research",
  workspace: "Personal",
  description: "Research notes, reading highlights, and synthesis documents.",
  noteCount: 8,
  folderCount: 2,
  guideCount: 1,
  bundleCount: 1,
  updatedAt: "2 days ago",
};

const stubTree: TreeNode[] = [
  {
    id: "folder-1",
    label: "Reading notes",
    type: "folder",
    children: [
      { id: "note-1", label: "The Almanack of Naval Ravikant", type: "note" },
      { id: "note-2", label: "Thinking in Systems", type: "note" },
    ],
  },
  {
    id: "folder-2",
    label: "Synthesis",
    type: "folder",
    children: [
      { id: "note-3", label: "Mental models index", type: "note" },
    ],
  },
  { id: "guide-1", label: "Research workflow guide", type: "guide" },
  { id: "bundle-1", label: "Research context bundle", type: "bundle" },
];

const stubNotes = [
  {
    id: "note-1",
    title: "The Almanack of Naval Ravikant",
    kind: "note" as const,
    excerpt:
      "Notes from reading Naval's almanack. Covers wealth creation, leverage, and long-term thinking.",
    updatedAt: "2 days ago",
    tags: ["books", "wealth", "thinking"],
  },
  {
    id: "note-2",
    title: "Thinking in Systems",
    kind: "note" as const,
    excerpt:
      "System dynamics concepts from Donella Meadows. Stocks, flows, feedback loops.",
    updatedAt: "4 days ago",
    tags: ["books", "systems"],
  },
  {
    id: "guide-1",
    title: "Research workflow guide",
    kind: "guide" as const,
    excerpt:
      "How to capture, process, and synthesize research in this box. Start here.",
    updatedAt: "1 week ago",
    tags: ["meta", "workflow"],
  },
  {
    id: "bundle-1",
    title: "Research context bundle",
    kind: "bundle" as const,
    excerpt:
      "Curated context for AI-assisted research sessions: goals, constraints, and key references.",
    updatedAt: "1 week ago",
    tags: ["ai", "bundle"],
  },
];

// ─── Right panel ─────────────────────────────────────────────────────────────

function BoxOverviewPanel() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Box overview
        </p>
      </div>
      <ScrollArea className="flex-1">
        <MetadataPanelStub
          title={stubBox.name}
          kind="box"
          tags={["research", "personal"]}
          metadata={[
            { label: "Workspace", value: stubBox.workspace },
            { label: "Updated", value: stubBox.updatedAt },
          ]}
        />

        <PanelSection title="Contents">
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            {[
              { icon: Folder, label: "Folders", count: stubBox.folderCount },
              { icon: FileText, label: "Notes", count: stubBox.noteCount },
              { icon: BookOpen, label: "Guides", count: stubBox.guideCount },
              { icon: Package, label: "Bundles", count: stubBox.bundleCount },
            ].map(({ icon: Icon, label, count }) => (
              <div key={label} className="flex items-center justify-between py-0.5">
                <div className="flex items-center gap-1.5">
                  <Icon className="h-3 w-3" />
                  <span>{label}</span>
                </div>
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                  {count}
                </Badge>
              </div>
            ))}
          </div>
        </PanelSection>
      </ScrollArea>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function BoxPage({
  params,
}: {
  params: Promise<{ box_id: string }>;
}) {
  void params; // box_id used for data fetching in a later prompt

  return (
    <AppShell rightPanel={<BoxOverviewPanel />}>
      <div className="flex h-full flex-col overflow-hidden">
        <PageHeader
          eyebrow={stubBox.workspace}
          title={stubBox.name}
          description={stubBox.description}
          actions={
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New note
            </Button>
          }
          below={
            <Tabs defaultValue="notes">
              <TabsList className="h-9 bg-transparent p-0 gap-1">
                <TabsTrigger
                  value="notes"
                  className="rounded-none border-b-2 border-transparent px-3 pb-3 text-sm data-[state=active]:border-foreground data-[state=active]:shadow-none"
                >
                  Notes
                </TabsTrigger>
                <TabsTrigger
                  value="tree"
                  className="rounded-none border-b-2 border-transparent px-3 pb-3 text-sm data-[state=active]:border-foreground data-[state=active]:shadow-none"
                >
                  Tree
                </TabsTrigger>
              </TabsList>
            </Tabs>
          }
        />

        <Tabs defaultValue="notes" className="flex flex-1 flex-col overflow-hidden">
          <TabsContent value="notes" className="flex-1 overflow-hidden m-0">
            <ScrollArea className="h-full">
              {stubNotes.length === 0 ? (
                <EmptyState
                  icon={<FileText className="h-5 w-5" />}
                  title="No notes in this box"
                  description="Create a note to start capturing context."
                  action={
                    <Button size="sm" className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" />
                      New note
                    </Button>
                  }
                  className="h-full"
                />
              ) : (
                <div className="mx-auto max-w-3xl flex flex-col gap-2 px-6 py-4">
                  {stubNotes.map((note) => (
                    <NoteStub key={note.id} {...note} />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="tree" className="flex-1 overflow-hidden m-0">
            <ScrollArea className="h-full">
              <div className="mx-auto max-w-3xl px-6 py-4">
                <TreeStub nodes={stubTree} />
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
