import { BookOpen, FileText, Tag, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { type Box } from "@/server/domain/types/box";
import { type Note } from "@/server/domain/types/note";
import { type NoteLink } from "@/server/domain/types/note_link";

interface BoxGuidePanelProps {
  box: Box;
  guideNote: Note | null;
  allNotes: Note[];
  /** All note links within the box (outgoing from all notes). */
  allLinks: NoteLink[];
}

/**
 * Box guide — structured interpretation surface.
 *
 * Provides a high-level orientation for the box:
 * - Guide note preview (if assigned)
 * - Top notes by retrieval_priority
 * - Most-linked notes (by incoming link count)
 * - Tag summary
 *
 * Distinct from guide_note_picker (which is the assignment control).
 * This panel is the "what is this box about?" surface for readers and AI.
 */
export function BoxGuidePanel({
  box,
  guideNote,
  allNotes,
  allLinks,
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

  return (
    <div className="flex flex-col gap-6">
      {/* Guide note */}
      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" />
          Guide note
        </h3>
        {guideNote ? (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
            <div className="flex items-start gap-2">
              <Link
                href={`/app/notes/${guideNote.id}`}
                className="flex-1 text-sm font-medium text-foreground hover:underline underline-offset-2"
              >
                {guideNote.title}
              </Link>
              <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
                Guide
              </Badge>
            </div>
            {guideNote.summary && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {guideNote.summary}
              </p>
            )}
            {guideNote.read_hint && (
              <p className="text-xs text-muted-foreground/70 italic">
                {guideNote.read_hint}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5 shrink-0" />
            <span>No guide note assigned. Set one from the box panel.</span>
          </div>
        )}
      </div>

      {/* High-priority notes */}
      {topNotes.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            High-priority notes
          </h3>
          <div className="flex flex-col gap-1">
            {topNotes.map((note) => (
              <Link
                key={note.id}
                href={`/app/notes/${note.id}`}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm transition-fast hover:border-ring hover:shadow-sm"
              >
                <span className="flex-1 truncate text-foreground/80 hover:text-foreground">
                  {note.title}
                </span>
                <Badge
                  variant="outline"
                  className="shrink-0 text-[10px] font-mono font-normal"
                  title="Retrieval priority"
                >
                  p{note.retrieval_priority}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Most linked notes */}
      {mostLinked.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <ArrowRight className="h-3.5 w-3.5" />
            Most linked notes
          </h3>
          <div className="flex flex-col gap-1">
            {mostLinked.map((note) => {
              const count = incomingCount.get(note.id) ?? 0;
              return (
                <Link
                  key={note.id}
                  href={`/app/notes/${note.id}`}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm transition-fast hover:border-ring hover:shadow-sm"
                >
                  <span className="flex-1 truncate text-foreground/80 hover:text-foreground">
                    {note.title}
                  </span>
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-[10px] font-normal"
                    title="Incoming links"
                  >
                    {count} link{count !== 1 ? "s" : ""}
                  </Badge>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Tag cloud */}
      {topTags.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Tag className="h-3.5 w-3.5" />
            Common tags
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

      {activeNotes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No notes yet. Create some notes to see the box guide.
        </p>
      )}
    </div>
  );
}
