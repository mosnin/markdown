"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { type Note } from "@/server/domain/types/note";
import {
  RELATIONSHIP_TYPE,
  type RelationshipType,
} from "@/server/domain/constants/note_constants";
import { createLinkAction } from "@/app/app/links/actions";

const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  related: "Related — general association",
  depends_on: "Depends on — source requires target to make sense",
  parent_of: "Parent of — source is a conceptual parent of target",
  child_of: "Child of — source is a conceptual child of target",
  reference_for: "Reference for — source is cited as a reference",
  extends: "Extends — source builds upon or continues target",
  example_of: "Example of — source is a concrete example of target",
  sibling_of: "Sibling of — source and target are peer-level",
  supersedes: "Supersedes — source replaces or supersedes target",
  derived_from: "Derived from — source was derived or extracted from target",
};

interface CreateLinkDialogProps {
  /** The note from which the link originates. */
  sourceNoteId: string;
  /** All notes in the same box (excluding the source note). */
  eligibleNotes: Note[];
}

/**
 * Dialog for creating a directed note link.
 * Source is fixed; user picks target note, relationship type, and optional note.
 */
export function CreateLinkDialog({
  sourceNoteId,
  eligibleNotes,
}: CreateLinkDialogProps) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [relType, setRelType] = useState<RelationshipType>(RELATIONSHIP_TYPE.RELATED);
  const [relNote, setRelNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setTargetId("");
    setRelType(RELATIONSHIP_TYPE.RELATED);
    setRelNote("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetId) return;
    setError(null);

    startTransition(async () => {
      const result = await createLinkAction(
        sourceNoteId,
        targetId,
        relType,
        relNote.trim() || null
      );
      if (result.ok) {
        setOpen(false);
        reset();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const sortedNotes = [...eligibleNotes].sort((a, b) =>
    a.title.localeCompare(b.title)
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5" />
        }
      >
        <Link2 className="h-3.5 w-3.5" />
        Add link
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link to another note</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* Target note */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="link-target">
              Target note
            </label>
            {sortedNotes.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No other notes in this box yet.
              </p>
            ) : (
              <select
                id="link-target"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                required
                disabled={isPending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                <option value="">Select a note…</option>
                {sortedNotes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Relationship type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="link-rel-type">
              Relationship
            </label>
            <select
              id="link-rel-type"
              value={relType}
              onChange={(e) => setRelType(e.target.value as RelationshipType)}
              disabled={isPending}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              {(Object.values(RELATIONSHIP_TYPE) as RelationshipType[]).map((t) => (
                <option key={t} value={t}>
                  {RELATIONSHIP_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {/* Relationship note (optional) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="link-rel-note">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="link-rel-note"
              value={relNote}
              onChange={(e) => setRelNote(e.target.value)}
              disabled={isPending}
              rows={2}
              placeholder="Describe the specific nature of this connection…"
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>

          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

          <DialogFooter showCloseButton>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !targetId || sortedNotes.length === 0}
            >
              {isPending ? "Linking…" : "Create link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
