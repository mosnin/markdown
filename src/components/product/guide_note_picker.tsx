"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type Note } from "@/server/domain/types/note";
import { assignGuideNoteAction, clearGuideNoteAction } from "@/app/app/boxes/actions";

interface GuideNotePickerProps {
  boxId: string;
  /** The current guide note, or null if none assigned. */
  currentGuideNote: Note | null;
  /** All notes in the box (for selection). */
  notes: Note[];
}

/**
 * Inline guide note assignment control for the box page.
 *
 * Shows the current guide note with a "clear" option, or an inline
 * select to choose a note as the guide.
 *
 * boxes.guide_note_id is the canonical assignment — this component
 * is the only place that sets or clears it from the UI.
 */
export function GuideNotePicker({
  boxId,
  currentGuideNote,
  notes,
}: GuideNotePickerProps) {
  const [selecting, setSelecting] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setError(null);
    startTransition(async () => {
      const result = await assignGuideNoteAction(boxId, selectedId);
      if (result.ok) {
        setSelecting(false);
        setSelectedId("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleClear() {
    setError(null);
    startTransition(async () => {
      const result = await clearGuideNoteAction(boxId);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  // Notes eligible for guide: all notes except the current guide
  const eligible = notes.filter((n) => n.id !== currentGuideNote?.id);

  if (currentGuideNote) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5">
          <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <a
            href={`/app/notes/${currentGuideNote.id}`}
            className="flex-1 truncate text-sm text-foreground hover:underline"
          >
            {currentGuideNote.title}
          </a>
          <Badge variant="secondary" className="text-[10px] font-normal">
            Guide
          </Badge>
          <button
            type="button"
            onClick={handleClear}
            disabled={isPending}
            className="rounded p-0.5 text-muted-foreground transition-fast hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Clear guide note assignment"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  if (selecting) {
    return (
      <form onSubmit={handleAssign} className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={isPending}
            autoFocus
            className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="">Select a note…</option>
            {eligible.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </select>
          <Button
            type="submit"
            size="sm"
            disabled={isPending || !selectedId}
          >
            Assign
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { setSelecting(false); setError(null); }}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-2 rounded-md border border-dashed border-border px-3 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1 font-medium">No guide note assigned</span>
          {notes.length > 0 && (
            <button
              type="button"
              onClick={() => setSelecting(true)}
              className="text-xs text-muted-foreground underline underline-offset-2 transition-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              Assign
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground/70 leading-relaxed">
          A guide note orients retrieval for this box. AI agents read it first.
          {notes.length === 0
            ? " Create a note to assign as the guide."
            : " Select a note to assign as the guide."}
        </p>
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}
