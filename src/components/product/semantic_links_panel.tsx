"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { type NoteLink } from "@/server/domain/types/note_link";
import { type Note } from "@/server/domain/types/note";
import { CreateLinkDialog } from "@/components/product/create/create_link_dialog";
import { deleteLinkAction } from "@/app/app/links/actions";
import { cn } from "@/lib/utils";

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

interface SemanticLinksPanelProps {
  sourceNoteId: string;
  outgoing: NoteLink[];
  incoming: NoteLink[];
  allBoxNotes: Note[];
}

/**
 * Presents note links as explicit semantic context relationships — not as a
 * backlink navigation system. These relationships tell the AI what this note
 * relates to and how, and are included automatically in context bundles.
 */
export function SemanticLinksPanel({
  sourceNoteId,
  outgoing,
  incoming,
  allBoxNotes,
}: SemanticLinksPanelProps) {
  const noteMap = new Map(allBoxNotes.map((n) => [n.id, n]));
  const eligibleNotes = allBoxNotes.filter((n) => n.id !== sourceNoteId);
  const hasLinks = outgoing.length > 0 || incoming.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Context relationships
        </h3>
        <CreateLinkDialog
          sourceNoteId={sourceNoteId}
          eligibleNotes={eligibleNotes}
        />
      </div>

      {/* Empty state */}
      {!hasLinks && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          No context relationships yet. Links define how this note relates to
          others in the same box — included automatically in context bundles.
        </p>
      )}

      {/* Outgoing links — this note points to others */}
      {outgoing.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            <ArrowRight className="h-3 w-3" />
            This note →
          </p>
          <div className="flex flex-col gap-1">
            {outgoing.map((link) => {
              const target = noteMap.get(link.target_note_id);
              return (
                <ContextLinkRow
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

      {/* Incoming links — other notes point to this one */}
      {incoming.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            <ArrowLeft className="h-3 w-3" />
            → Referred by
          </p>
          <div className="flex flex-col gap-1">
            {incoming.map((link) => {
              const source = noteMap.get(link.source_note_id);
              return (
                <ContextLinkRow
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

// ─── ContextLinkRow ───────────────────────────────────────────────────────────

function ContextLinkRow({
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
    <div
      className={cn(
        "group flex flex-col gap-1 rounded-md border border-border bg-card px-2.5 py-2 text-sm"
      )}
    >
      <div className="flex items-center gap-2">
        {/* Relationship type badge */}
        <Badge
          variant="secondary"
          className="shrink-0 text-[10px] font-normal"
        >
          {REL_LABEL[link.relationship_type] ?? link.relationship_type}
        </Badge>

        {/* Linked note title */}
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

        {/* Delete button — outgoing links only */}
        {direction === "outgoing" && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 transition-fast group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            aria-label="Remove context relationship"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Relationship annotation */}
      {link.relationship_note && (
        <p className="pl-0.5 text-[11px] italic text-muted-foreground/70 leading-relaxed">
          {link.relationship_note}
        </p>
      )}

      {error && (
        <p className="w-full text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
