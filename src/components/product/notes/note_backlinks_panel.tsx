"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight, Link2, Link2Off, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { type NoteLink } from "@/server/domain/types/note_link";
import { type Note } from "@/server/domain/types/note";
import { createLinkAction } from "@/app/app/links/actions";

// ─── Relationship label map ────────────────────────────────────────────────────

const REL_LABEL: Record<string, string> = {
  related: "Related to",
  depends_on: "Depends on",
  parent_of: "Parent of",
  child_of: "Child of",
  reference_for: "Reference for",
  extends: "Extends",
  example_of: "Example of",
  sibling_of: "Sibling of",
  supersedes: "Supersedes",
  derived_from: "Derived from",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface BacklinkRow {
  link: NoteLink;
  sourceNote: Note | null;
}

interface UnlinkedMention {
  noteId: string;
  title: string;
}

// ─── Backlinks Panel ──────────────────────────────────────────────────────────

interface NoteBacklinksPanelProps {
  /** The note being viewed. */
  noteId: string;
  /** Used to navigate to source notes. */
  workspaceId: string;
  /** Incoming links from the server. */
  incoming: NoteLink[];
  /** All notes in the box — used to resolve titles and detect unlinked mentions. */
  allBoxNotes: Note[];
  /** The raw markdown content of the current note (for unlinked-mention scan). */
  markdownContent: string;
}

/**
 * Shows all notes that link TO the current note (backlinks), grouped by
 * relationship type, plus an unlinked-mention section below.
 */
export function NoteBacklinksPanel({
  noteId,
  incoming,
  allBoxNotes,
  markdownContent,
}: NoteBacklinksPanelProps) {
  const noteMap = new Map(allBoxNotes.map((n) => [n.id, n]));

  // Build backlink rows with resolved source note metadata
  const backlinkRows: BacklinkRow[] = incoming.map((link) => ({
    link,
    sourceNote: noteMap.get(link.source_note_id) ?? null,
  }));

  // Group by relationship type
  const groups = new Map<string, BacklinkRow[]>();
  for (const row of backlinkRows) {
    const key = row.link.relationship_type;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Backlinks ({incoming.length})
        </h3>
      </div>

      {/* Empty state */}
      {backlinkRows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-5 text-center">
          <Link2Off
            className="mx-auto mb-1.5 h-5 w-5 text-muted-foreground/40"
            aria-hidden="true"
          />
          <p className="text-xs text-muted-foreground">
            No backlinks yet. Other notes that link to this one will appear here.
          </p>
        </div>
      )}

      {/* Grouped backlink rows */}
      {[...groups.entries()].map(([relType, rows]) => (
        <div key={relType} className="flex flex-col gap-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
            {REL_LABEL[relType] ?? relType}
          </p>
          {rows.map(({ link, sourceNote }) => (
            <BacklinkRow key={link.id} link={link} sourceNote={sourceNote} />
          ))}
        </div>
      ))}

      {/* Unlinked mentions section */}
      <UnlinkedMentionsSection
        currentNoteId={noteId}
        allBoxNotes={allBoxNotes}
        markdownContent={markdownContent}
        existingIncoming={incoming}
      />
    </div>
  );
}

// ─── BacklinkRow ──────────────────────────────────────────────────────────────

function BacklinkRow({
  link,
  sourceNote,
}: {
  link: NoteLink;
  sourceNote: Note | null;
}) {
  const title = sourceNote?.title ?? "Unknown note";
  const noteId = link.source_note_id;

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card px-2.5 py-2 text-sm">
      <div className="flex items-center gap-2">
        {/* Relationship type badge */}
        <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
          {REL_LABEL[link.relationship_type] ?? link.relationship_type}
        </Badge>

        {/* Source note title — link to that note */}
        <div className="min-w-0 flex-1">
          {sourceNote ? (
            <Link
              href={`/app/notes/${noteId}`}
              className="block truncate text-xs text-foreground hover:underline underline-offset-2"
            >
              {title}
            </Link>
          ) : (
            <span className="truncate text-xs text-muted-foreground">{title}</span>
          )}
        </div>
      </div>

      {/* Path subtitle */}
      {sourceNote?.path_cache && (
        <p className="truncate font-mono text-[10px] text-muted-foreground/50">
          {sourceNote.path_cache}
        </p>
      )}

      {/* Annotation */}
      {link.relationship_note && (
        <p className="pl-0.5 text-[11px] italic leading-relaxed text-muted-foreground/70">
          {link.relationship_note}
        </p>
      )}
    </div>
  );
}

// ─── UnlinkedMentionsSection ──────────────────────────────────────────────────

interface UnlinkedMentionsSectionProps {
  currentNoteId: string;
  allBoxNotes: Note[];
  markdownContent: string;
  existingIncoming: NoteLink[];
}

function UnlinkedMentionsSection({
  currentNoteId,
  allBoxNotes,
  markdownContent,
  existingIncoming,
}: UnlinkedMentionsSectionProps) {
  const [open, setOpen] = useState(false);
  const [mentions, setMentions] = useState<UnlinkedMention[]>([]);

  // Ids of notes that already have an explicit link TO this note (either direction)
  const linkedNoteIds = new Set(existingIncoming.map((l) => l.source_note_id));

  useEffect(() => {
    // Run the unlinked-mention scan client-side after initial render
    const candidateNotes = allBoxNotes.filter(
      (n) => n.id !== currentNoteId && !linkedNoteIds.has(n.id)
    );

    const found: UnlinkedMention[] = [];
    for (const note of candidateNotes) {
      if (note.title && markdownContent.includes(note.title)) {
        found.push({ noteId: note.id, title: note.title });
        if (found.length >= 5) break;
      }
    }
    setMentions(found);
  // Only re-run when the content or note list changes (not on every render)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdownContent, allBoxNotes.length, currentNoteId]);

  if (mentions.length === 0) return null;

  return (
    <div className="mt-1 border-t border-border pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
        Unlinked Mentions ({mentions.length})
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            These notes are mentioned by title in this note but have no explicit
            link yet.
          </p>
          {mentions.map((m) => (
            <UnlinkedMentionRow
              key={m.noteId}
              mention={m}
              currentNoteId={currentNoteId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── UnlinkedMentionRow ───────────────────────────────────────────────────────

function UnlinkedMentionRow({
  mention,
  currentNoteId,
}: {
  mention: UnlinkedMention;
  currentNoteId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCreateLink() {
    setError(null);
    startTransition(async () => {
      const result = await createLinkAction(
        currentNoteId,
        mention.noteId,
        "related"
      );
      if (result.ok) {
        setDone(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (done) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2">
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">
        {mention.title}
      </span>
      <button
        type="button"
        onClick={handleCreateLink}
        disabled={isPending}
        className={cn(
          "shrink-0 rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
          "bg-primary/10 text-primary hover:bg-primary/20",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
        aria-label={`Create link to ${mention.title}`}
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          "Create link"
        )}
      </button>
      {error && (
        <p className="w-full text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
