import { BookOpen, FileText, Tag, ArrowRight, Folder, Bot } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { type Box } from "@/server/domain/types/box";
import { type Note } from "@/server/domain/types/note";
import { type NoteLink } from "@/server/domain/types/note_link";
import { type Folder as FolderType } from "@/server/domain/types/folder";
import { RetrievalHintBadge } from "@/components/product/retrieval_hint_badge";

interface BoxGuidePanelProps {
  box: Box;
  guideNote: Note | null;
  allNotes: Note[];
  /** All note links within the box (outgoing from all notes). */
  allLinks: NoteLink[];
  /** All folders in the box — used for structure summary and policy display. */
  folders?: FolderType[];
}

/**
 * Box guide — the machine interpretation layer for a box.
 *
 * This is the structured surface that answers "what is this box for and how
 * should it be read?" for both humans and AI agents. Distinct from:
 *
 *   - guide_note: the single note that acts as the front door (boxes.guide_note_id)
 *   - box overview: the full hierarchy + link graph
 *   - context bundle: the bounded retrieval package for a specific note
 *
 * The box guide panel shows:
 *   1. Guide note with summary and retrieval hints
 *   2. High-priority notes (retrieval_priority > 0)
 *   3. Most-linked notes (structural importance by incoming edge count)
 *   4. Tag vocabulary
 *   5. Folder structure and AI generation policies
 */
export function BoxGuidePanel({
  box,
  guideNote,
  allNotes,
  allLinks,
  folders = [],
}: BoxGuidePanelProps) {
  const activeNotes = allNotes.filter((n) => n.status === "active");

  // ── Most linked (by incoming edge count) ─────────────────────────────────
  const incomingCount = new Map<string, number>();
  for (const link of allLinks) {
    incomingCount.set(
      link.target_note_id,
      (incomingCount.get(link.target_note_id) ?? 0) + 1
    );
  }

  const mostLinked = [...activeNotes]
    .filter((n) => (incomingCount.get(n.id) ?? 0) > 0)
    .sort(
      (a, b) =>
        (incomingCount.get(b.id) ?? 0) - (incomingCount.get(a.id) ?? 0)
    )
    .slice(0, 5);

  // ── Top notes by retrieval_priority ──────────────────────────────────────
  const topNotes = [...activeNotes]
    .filter((n) => n.id !== guideNote?.id && n.retrieval_priority > 0)
    .sort((a, b) => b.retrieval_priority - a.retrieval_priority)
    .slice(0, 5);

  // ── Tag frequency ─────────────────────────────────────────────────────────
  const tagCounts = new Map<string, number>();
  for (const note of activeNotes) {
    for (const tag of note.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tag]) => tag);

  // ── Folders with AI generation policy ────────────────────────────────────
  const generatedFolders = folders.filter((f) => f.accepts_generated_notes);
  const activeFolders = folders.filter((f) => f.status === "active");

  const empty = activeNotes.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Section header */}
      <div className="flex flex-col gap-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Machine interpretation layer
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground/70">
          How this box is understood by AI agents. The guide note is read first.
          High-priority and most-linked notes shape retrieval order.
        </p>
      </div>

      {/* Structure summary */}
      <div className="flex items-center gap-4 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Folder className="h-3 w-3" aria-hidden="true" />
          {activeFolders.length} folder{activeFolders.length !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" aria-hidden="true" />
          {activeNotes.length} note{activeNotes.length !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1">
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
          {allLinks.length} link{allLinks.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Guide note — front door */}
      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          Guide note
        </h3>
        {guideNote ? (
          <div className="flex flex-col gap-2 rounded-md border border-amber-300/60 bg-amber-50/40 p-3 dark:border-amber-600/40 dark:bg-amber-900/10">
            <div className="flex items-start gap-2">
              <Link
                href={`/app/notes/${guideNote.id}`}
                className="flex-1 text-sm font-medium text-foreground hover:underline underline-offset-2"
              >
                {guideNote.title}
              </Link>
              <Badge
                variant="secondary"
                className="shrink-0 text-[10px] font-normal text-amber-700 dark:text-amber-400"
              >
                Guide
              </Badge>
            </div>
            {guideNote.summary && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {guideNote.summary}
              </p>
            )}
            <RetrievalHintBadge
              readHint={guideNote.read_hint}
              retrievalPriority={guideNote.retrieval_priority}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border px-3 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="font-medium">No guide note assigned</span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground/70">
              A guide note orients retrieval for this box. AI agents read it
              first. Assign one via the box context panel.
            </p>
          </div>
        )}
      </div>

      {/* High-priority notes */}
      {topNotes.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            High-priority notes
          </h3>
          <p className="text-[11px] text-muted-foreground/60">
            Notes with retrieval_priority &gt; 0 are included in context bundles
            with higher preference.
          </p>
          <div className="flex flex-col gap-1">
            {topNotes.map((note) => (
              <Link
                key={note.id}
                href={`/app/notes/${note.id}`}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm transition-fast hover:border-ring/50 hover:shadow-sm"
              >
                <span className="flex-1 truncate text-foreground/80 hover:text-foreground">
                  {note.title}
                </span>
                <span
                  className="shrink-0 font-mono text-[10px] text-muted-foreground"
                  title="Retrieval priority"
                >
                  p{note.retrieval_priority}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Most linked notes */}
      {mostLinked.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            Most referenced
          </h3>
          <p className="text-[11px] text-muted-foreground/60">
            Notes that many other notes link to — likely structural or foundational.
          </p>
          <div className="flex flex-col gap-1">
            {mostLinked.map((note) => {
              const count = incomingCount.get(note.id) ?? 0;
              return (
                <Link
                  key={note.id}
                  href={`/app/notes/${note.id}`}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm transition-fast hover:border-ring/50 hover:shadow-sm"
                >
                  <span className="flex-1 truncate text-foreground/80 hover:text-foreground">
                    {note.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {count} ref{count !== 1 ? "s" : ""}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Tag vocabulary */}
      {topTags.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Tag className="h-3.5 w-3.5" aria-hidden="true" />
            Tag vocabulary
          </h3>
          <div className="flex flex-wrap gap-1">
            {topTags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs font-normal">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* AI generation folders */}
      {generatedFolders.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Bot className="h-3.5 w-3.5" aria-hidden="true" />
            AI write folders
          </h3>
          <p className="text-[11px] text-muted-foreground/60">
            Connected tools can write generated notes directly into these folders
            without human review.
          </p>
          <div className="flex flex-col gap-1">
            {generatedFolders.map((folder) => (
              <div
                key={folder.id}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs"
              >
                <Folder className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                <span className="truncate text-muted-foreground">{folder.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {empty && (
        <p className="text-sm text-muted-foreground">
          No notes yet. Create some notes to populate the box guide.
        </p>
      )}
    </div>
  );
}
