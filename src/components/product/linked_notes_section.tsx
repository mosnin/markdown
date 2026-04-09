"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { type NoteLink } from "@/server/domain/types/note_link";
import { type Note } from "@/server/domain/types/note";
import { CreateLinkDialog } from "@/components/product/create_link_dialog";
import { deleteLinkAction } from "@/app/app/links/actions";

const REL_LABEL: Record<string, string> = {
  related: "related",
  references: "references",
  extends: "extends",
  contradicts: "contradicts",
  supersedes: "supersedes",
};

interface LinkedNotesSectionProps {
  sourceNoteId: string;
  outgoing: NoteLink[];
  incoming: NoteLink[];
  /** All notes in the same box (used for link creation and title lookup). */
  allBoxNotes: Note[];
}

/**
 * Shows outgoing and incoming note links for a note.
 * Allows adding new links and deleting existing ones.
 */
export function LinkedNotesSection({
  sourceNoteId,
  outgoing,
  incoming,
  allBoxNotes,
}: LinkedNotesSectionProps) {
  const noteMap = new Map(allBoxNotes.map((n) => [n.id, n]));
  const eligibleNotes = allBoxNotes.filter((n) => n.id !== sourceNoteId);

  const hasLinks = outgoing.length > 0 || incoming.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Linked notes
        </h3>
        <CreateLinkDialog
          sourceNoteId={sourceNoteId}
          eligibleNotes={eligibleNotes}
        />
      </div>

      {!hasLinks && (
        <p className="text-xs text-muted-foreground">
          No links yet. Add a link to connect this note to another.
        </p>
      )}

      {/* Outgoing links */}
      {outgoing.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            <ArrowRight className="h-3 w-3" />
            From this note
          </p>
          <div className="flex flex-col gap-1">
            {outgoing.map((link) => {
              const target = noteMap.get(link.target_note_id);
              return (
                <LinkRow
                  key={link.id}
                  link={link}
                  linkedNote={target ?? null}
                  direction="outgoing"
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Incoming links */}
      {incoming.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            <ArrowLeft className="h-3 w-3" />
            To this note
          </p>
          <div className="flex flex-col gap-1">
            {incoming.map((link) => {
              const source = noteMap.get(link.source_note_id);
              return (
                <LinkRow
                  key={link.id}
                  link={link}
                  linkedNote={source ?? null}
                  direction="incoming"
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LinkRow ──────────────────────────────────────────────────────────────────

function LinkRow({
  link,
  linkedNote,
  direction,
}: {
  link: NoteLink;
  linkedNote: Note | null;
  direction: "outgoing" | "incoming";
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteLinkAction(link.id);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const noteId =
    direction === "outgoing" ? link.target_note_id : link.source_note_id;
  const title = linkedNote?.title ?? "Unknown note";

  return (
    <div className="group flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm">
      <div className="min-w-0 flex-1">
        {linkedNote ? (
          <Link
            href={`/app/notes/${noteId}`}
            className="block truncate text-foreground hover:underline underline-offset-2"
          >
            {title}
          </Link>
        ) : (
          <span className="truncate text-muted-foreground">{title}</span>
        )}
      </div>
      <Badge
        variant="secondary"
        className="shrink-0 text-[10px] font-normal capitalize"
      >
        {REL_LABEL[link.relationship_type] ?? link.relationship_type}
      </Badge>
      {/* Delete — outgoing links only (we own the direction) */}
      {direction === "outgoing" && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 transition-fast group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          title="Remove link"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      {error && (
        <p className="w-full text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
