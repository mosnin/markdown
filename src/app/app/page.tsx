import { Archive, BookOpen, Box, FileText } from "lucide-react";
import { PageHeader } from "@/components/product/page_header";
import { NoteStub } from "@/components/product/note_stub";
import { PanelSection } from "@/components/product/panel_section";
import { ScrollArea } from "@/components/ui/scroll-area";

// ─── Stub data — replaced with server queries in a later prompt ──────────────

const recentNotes = [
  {
    id: "note-1",
    title: "Getting started with Context Store",
    kind: "guide" as const,
    excerpt:
      "Context Store is a structured, markdown-native operating system for both human and AI context.",
    updatedAt: "Just now",
    tags: ["onboarding", "context"],
  },
  {
    id: "note-2",
    title: "Weekly research digest",
    kind: "note" as const,
    excerpt:
      "A running collection of reading notes and references from this week.",
    updatedAt: "2 days ago",
    tags: ["research"],
  },
  {
    id: "note-3",
    title: "Project Alpha context bundle",
    kind: "bundle" as const,
    excerpt:
      "Curated context for Project Alpha: goals, constraints, key decisions, open questions.",
    updatedAt: "3 days ago",
    tags: ["project-alpha"],
  },
];

const statCards = [
  { label: "Workspaces", value: "1", icon: Archive },
  { label: "Boxes", value: "3", icon: Box },
  { label: "Notes", value: "12", icon: FileText },
  { label: "Guides", value: "2", icon: BookOpen },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AppHomePage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Home"
        description="Recent activity across your workspaces."
      />

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-8 px-6 py-6">
          {/* Quick stats */}
          <section>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {statCards.map(({ label, value, icon: Icon }) => (
                <div
                  key={label}
                  className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    <span className="text-xs">{label}</span>
                  </div>
                  <span className="text-2xl font-semibold tracking-tight text-foreground">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Recent notes */}
          <PanelSection title="Recent" noSeparator className="px-0">
            <div className="flex flex-col gap-2">
              {recentNotes.map((note) => (
                <NoteStub key={note.id} {...note} />
              ))}
            </div>
          </PanelSection>
        </div>
      </ScrollArea>
    </div>
  );
}
