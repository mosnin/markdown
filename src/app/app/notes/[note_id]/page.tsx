import { BookOpen, ChevronRight, Clock, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AppShell } from "@/components/product/app_shell";
import { MetadataPanelStub } from "@/components/product/metadata_panel_stub";
import { PageHeader } from "@/components/product/page_header";

// ─── Stub data ───────────────────────────────────────────────────────────────

const stubNote = {
  id: "note-1",
  title: "The Almanack of Naval Ravikant",
  kind: "note" as const,
  box: "Research",
  workspace: "Personal",
  folder: "Reading notes",
  updatedAt: "2 days ago",
  createdAt: "2 weeks ago",
  tags: ["books", "wealth", "thinking"],
  wordCount: 1240,
  excerpt: `Notes from reading The Almanack of Naval Ravikant, a collection of Naval's wisdom on wealth, happiness, and philosophy.

## Key ideas

- Specific knowledge is knowledge you cannot be trained for. If society can train you, they can train someone else and replace you.
- Leverage comes from labour, capital, code, and media. Code and media are permissionless levers.
- Play long-term games with long-term people. Long-term games have compounding returns.

## On reading

Read what you love until you love to read. Reading is not a race to finish books. It is a habit of returning to ideas.`,
};

// ─── Right panel ─────────────────────────────────────────────────────────────

function NoteMetadataPanel() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Note details
        </p>
      </div>
      <ScrollArea className="flex-1">
        <MetadataPanelStub
          title={stubNote.title}
          kind={stubNote.kind}
          tags={stubNote.tags}
          metadata={[
            { label: "Workspace", value: stubNote.workspace },
            { label: "Box", value: stubNote.box },
            { label: "Folder", value: stubNote.folder },
            { label: "Created", value: stubNote.createdAt },
            { label: "Updated", value: stubNote.updatedAt },
          ]}
        />
      </ScrollArea>
    </div>
  );
}

// ─── Breadcrumb ──────────────────────────────────────────────────────────────

function Breadcrumb() {
  const parts = [stubNote.workspace, stubNote.box, stubNote.folder];
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      {parts.map((part, i) => (
        <span key={part} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3" />}
          <span>{part}</span>
        </span>
      ))}
    </div>
  );
}

// ─── Placeholder content body ─────────────────────────────────────────────────

function NoteBody({ content }: { content: string }) {
  return (
    <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      {content.split("\n\n").map((block, i) => {
        if (block.startsWith("## ")) {
          return (
            <h2
              key={i}
              className="mt-6 mb-2 text-base font-semibold tracking-tight text-foreground"
            >
              {block.replace("## ", "")}
            </h2>
          );
        }
        if (block.startsWith("- ")) {
          const items = block.split("\n").filter((l) => l.startsWith("- "));
          return (
            <ul key={i} className="my-2 ml-4 space-y-1.5 text-sm text-foreground/80">
              {items.map((item, j) => (
                <li key={j} className="list-disc">
                  {item.replace("- ", "")}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="my-2 text-sm leading-relaxed text-foreground/80">
            {block}
          </p>
        );
      })}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function NotePage({
  params,
}: {
  params: Promise<{ note_id: string }>;
}) {
  void params; // note_id used for data fetching in a later prompt

  return (
    <AppShell rightPanel={<NoteMetadataPanel />}>
      <div className="flex h-full flex-col overflow-hidden">
        <PageHeader
          title={stubNote.title}
          eyebrow={`${stubNote.box} / ${stubNote.folder}`}
          actions={
            <Button variant="outline" size="sm">
              Edit
            </Button>
          }
        />

        <ScrollArea className="flex-1">
          <div className="mx-auto max-w-2xl px-6 py-6">
            {/* Meta bar */}
            <div className="mb-6 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <Breadcrumb />
              <Separator orientation="vertical" className="h-3" />
              <div className="flex items-center gap-1">
                {stubNote.kind === "note" ? (
                  <FileText className="h-3 w-3" />
                ) : (
                  <BookOpen className="h-3 w-3" />
                )}
                <span className="capitalize">{stubNote.kind}</span>
              </div>
              <Separator orientation="vertical" className="h-3" />
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>Updated {stubNote.updatedAt}</span>
              </div>
              <Separator orientation="vertical" className="h-3" />
              <span>{stubNote.wordCount.toLocaleString()} words</span>
            </div>

            {/* Tags */}
            {stubNote.tags.length > 0 && (
              <div className="mb-6 flex flex-wrap gap-1.5">
                {stubNote.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs font-normal">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            <Separator className="mb-6" />

            {/* Note content — placeholder rendering, no editor yet */}
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-3 mb-6">
              <p className="text-xs text-muted-foreground">
                Note editor placeholder — markdown rendering and editing
                will be wired in a later prompt.
              </p>
            </div>

            <NoteBody content={stubNote.excerpt} />
          </div>
        </ScrollArea>
      </div>
    </AppShell>
  );
}
