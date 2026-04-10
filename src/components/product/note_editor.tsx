"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Code2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { renderMarkdown } from "@/lib/markdown";
import { type Note } from "@/server/domain/types/note";
import { saveNoteAction } from "@/app/app/notes/actions";
import {
  AutosaveStatus,
  type AutosaveState,
} from "@/components/product/autosave_status";

/**
 * Autosave debounce: 1500ms after the last content change.
 *
 * Every fired save calls saveNoteAction → update_note_and_create_version RPC,
 * which atomically creates a new immutable version. This is identical to the
 * manual save path — versioning, optimistic concurrency, and audit semantics
 * are fully preserved.
 */
const AUTOSAVE_DEBOUNCE_MS = 1500;

/**
 * Two view modes for the note editor:
 *
 *   document  — rendered markdown presented as a readable document (default).
 *               Clicking anywhere or focusing the title switches to markdown mode.
 *
 *   markdown  — editable raw markdown textarea, explicitly labeled as the exact
 *               source the AI model receives. Autosave and metadata editing happen here.
 *               No hidden conversion; the stored string equals what is shown.
 */
export type NoteViewMode = "document" | "markdown";

interface NoteEditorProps {
  note: Note;
  /** Initial view mode — defaults to "document" (rendered, human reading experience). */
  initialMode?: NoteViewMode;
}

export function NoteEditor({ note, initialMode = "document" }: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.markdown_content);
  const [summary, setSummary] = useState(note.summary ?? "");
  const [tagsInput, setTagsInput] = useState(note.tags.join(", "));
  const [readHint, setReadHint] = useState(note.read_hint ?? "");
  const [mode, setMode] = useState<NoteViewMode>(initialMode);

  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Ref-based guard to prevent concurrent saves across stale closures (Bug 2)
  const isSavingRef = useRef(false);
  // Ref to track the status-fade timeout so we can cancel it before setting a new one (Bug 4)
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const router = useRouter();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The snapshot of what was last successfully persisted to the database.
  // isDirty compares current state against this ref.
  const lastSavedSnapshot = useRef({
    title: note.title,
    content: note.markdown_content,
    summary: note.summary ?? "",
    tagsInput: note.tags.join(", "),
    readHint: note.read_hint ?? "",
  });

  // Bug 1: Reset all editor state when navigating to a different note
  useEffect(() => {
    setTitle(note.title);
    setContent(note.markdown_content);
    setSummary(note.summary ?? "");
    setTagsInput(note.tags.join(", "));
    setReadHint(note.read_hint ?? "");
    setAutosaveState("idle");
    setSaveError(null);
    // Cancel any pending debounce so it can't fire Note A's data into Note B
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    // Cancel any pending status-fade timeout
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }
    // Reset the last saved snapshot to the new note's data
    lastSavedSnapshot.current = {
      title: note.title,
      content: note.markdown_content,
      summary: note.summary ?? "",
      tagsInput: note.tags.join(", "),
      readHint: note.read_hint ?? "",
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  function parseTags(raw: string): string[] {
    return raw
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }

  // Reading refs during render is intentional here: lastSavedSnapshot tracks the
  // last persisted state for dirty-checking without causing re-renders on every
  // keystroke. The React Compiler rule is overly conservative for this pattern.
  // eslint-disable-next-line react-hooks/refs
  const isDirty =
    // eslint-disable-next-line react-hooks/refs
    title !== lastSavedSnapshot.current.title ||
    // eslint-disable-next-line react-hooks/refs
    content !== lastSavedSnapshot.current.content ||
    // eslint-disable-next-line react-hooks/refs
    summary !== lastSavedSnapshot.current.summary ||
    // eslint-disable-next-line react-hooks/refs
    tagsInput !== lastSavedSnapshot.current.tagsInput ||
    // eslint-disable-next-line react-hooks/refs
    readHint !== lastSavedSnapshot.current.readHint;

  /**
   * performSave — calls saveNoteAction with the current editor state.
   *
   * Uses the same update path as manual save: saveNoteAction →
   * update_note_and_create_version RPC → new immutable note_versions row.
   * Optimistic locking is handled by the RPC; this function does not bypass it.
   */
  const performSave = useCallback(async () => {
    // Bug 2: Use ref for guard to avoid stale-closure false negatives
    if (!title.trim() || isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    setAutosaveState("saving");
    setSaveError(null);

    try {
      const result = await saveNoteAction(note.id, {
        title,
        markdownContent: content,
        summary: summary.trim() || null,
        tags: parseTags(tagsInput),
        readHint: readHint.trim() || null,
      });

      if (result.ok) {
        const now = new Date();
        setSavedAt(now);
        setAutosaveState("saved");
        // Bug 3: Capture whether title changed before updating the snapshot, so
        // we can decide whether to call router.refresh() for sidebar sync.
        // Don't refresh after every autosave — it would clobber in-flight edits.
        const titleChanged = title !== lastSavedSnapshot.current.title;
        lastSavedSnapshot.current = { title, content, summary, tagsInput, readHint };
        if (titleChanged) {
          router.refresh();
        }
        // Bug 4: Cancel the previous status-fade timeout before scheduling a new one
        if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = setTimeout(() => {
          setAutosaveState((s: AutosaveState) => (s === "saved" ? "idle" : s));
        }, 4000);
      } else {
        setSaveError(result.error);
        setAutosaveState("error");
      }
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [note.id, title, content, summary, tagsInput, readHint, router]);

  /**
   * Autosave debounce effect.
   *
   * Fires AUTOSAVE_DEBOUNCE_MS after the last content change.
   * Immediately signals "unsaved" so the user sees feedback while the timer runs.
   * When the timer fires, performSave() takes over and transitions to "saving".
   */
  useEffect(() => {
    if (!isDirty) return;
    setAutosaveState("unsaved");
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void performSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [title, content, summary, tagsInput, readHint, isDirty, performSave]);

  // Flush timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const renderedHtml = renderMarkdown(content);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title ─────────────────────────────────────────────────────────── */}
      <div className="px-8 pb-3 pt-6">
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (mode === "document") setMode("markdown");
          }}
          onFocus={() => {
            if (mode === "document") setMode("markdown");
          }}
          placeholder="Untitled note"
          aria-label="Note title"
          className={cn(
            "w-full bg-transparent text-3xl font-bold tracking-tight text-foreground",
            "border-b-2 border-transparent pb-1",
            "transition-[border-color] duration-150",
            "focus:border-border focus:outline-none",
            "placeholder:text-muted-foreground/40"
          )}
        />
        {/* Metadata bar — created date, tags — visible below title */}
        {(note.created_at || note.tags.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {note.created_at && (
              <span className="text-xs text-muted-foreground">
                {new Date(note.created_at).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
            {note.tags.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {note.tags.join(" · ")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Toolbar: mode toggle + save state ─────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border px-8 py-1.5">
        {/* Mode toggle */}
        <div
          className="flex items-center gap-1"
          role="tablist"
          aria-label="Note view mode"
        >
          <ModeButton
            mode="document"
            current={mode}
            icon={<Eye className="h-3.5 w-3.5" />}
            label="Document"
            onClick={() => setMode("document")}
          />
          <ModeButton
            mode="markdown"
            current={mode}
            icon={<Code2 className="h-3.5 w-3.5" />}
            label="Markdown"
            onClick={() => setMode("markdown")}
          />
        </div>

        {/* Save state + retry */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "transition-opacity duration-300",
              autosaveState === "idle" ? "opacity-0" : "opacity-100"
            )}
          >
            <AutosaveStatus
              state={autosaveState}
              savedAt={savedAt}
              error={saveError}
              className="text-xs text-muted-foreground"
            />
          </span>
          {autosaveState === "error" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void performSave()}
              disabled={isSaving}
              className="h-8 text-xs"
            >
              Retry
            </Button>
          )}
        </div>
      </div>

      {/* ── Content area ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">

        {/* Document mode — rendered markdown for human reading */}
        {mode === "document" && (
          <div
            role="tabpanel"
            aria-label="Document view"
            tabIndex={0}
            className="h-full cursor-text focus:outline-none"
            onClick={() => setMode("markdown")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setMode("markdown");
            }}
          >
            {content ? (
              <div
                className="prose prose-neutral dark:prose-invert max-w-none px-8 py-6 text-base leading-7"
                // renderMarkdown output is sanitized — see src/lib/markdown.ts
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            ) : (
              <div
                className="flex h-full flex-col items-center justify-center gap-2 px-8"
                aria-hidden="true"
              >
                <p className="text-sm font-medium text-muted-foreground/60">
                  This note is empty
                </p>
                <p className="text-xs text-muted-foreground/40">
                  Click anywhere or switch to Markdown to start writing
                </p>
              </div>
            )}
          </div>
        )}

        {/* Markdown mode — editable raw source, labeled as AI-facing */}
        {mode === "markdown" && (
          <div
            role="tabpanel"
            aria-label="Markdown editor"
            className="flex h-full flex-col"
          >
            {/* Source label — tells the user this is what the AI receives */}
            <div className="flex items-center gap-2 border-b border-border/40 bg-muted/20 px-8 py-1.5">
              <Code2
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                aria-hidden="true"
              />
              <p className="text-xs text-muted-foreground/70">
                Raw markdown — the exact source the AI model receives
              </p>
            </div>

            {/* Editable textarea */}
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write in Markdown…"
              spellCheck
              aria-label="Markdown content"
              className={cn(
                "flex-1 resize-none bg-transparent px-8 py-6",
                "font-mono text-sm leading-7 text-foreground",
                "placeholder:text-muted-foreground/40 focus:outline-none"
              )}
            />
          </div>
        )}
      </div>

      {/* ── Metadata — shown in markdown mode ─────────────────────────────── */}
      {mode === "markdown" && (
        <div className="border-t border-border">
          <details className="group" open>
            <summary className="flex cursor-pointer items-center justify-between px-8 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
              Metadata
              <span className="text-[10px] uppercase tracking-wider opacity-60 group-open:hidden">
                expand
              </span>
            </summary>
            <div className="flex flex-col gap-3 px-8 pb-5 pt-2">
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="note-summary"
                >
                  Summary
                </label>
                <Input
                  id="note-summary"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="One-line summary for context retrieval"
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="note-tags"
                >
                  Tags{" "}
                  <span className="font-normal opacity-60">
                    (comma-separated)
                  </span>
                </label>
                <Input
                  id="note-tags"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="research, reading, ideas"
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="note-hint"
                >
                  Read hint{" "}
                  <span className="font-normal opacity-60">
                    (optional guidance for AI retrieval)
                  </span>
                </label>
                <Input
                  id="note-hint"
                  value={readHint}
                  onChange={(e) => setReadHint(e.target.value)}
                  placeholder="e.g. Read this before generating anything in the Research box"
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

// ─── ModeButton ───────────────────────────────────────────────────────────────

function ModeButton({
  mode,
  current,
  icon,
  label,
  onClick,
}: {
  mode: NoteViewMode;
  current: NoteViewMode;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  const isActive = mode === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition-fast",
        isActive
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
