"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Code2 } from "lucide-react";
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

// How long after the last keystroke before autosaving (ms)
const AUTOSAVE_DEBOUNCE_MS = 1500;

export type NoteViewMode = "document" | "edit" | "source";

interface NoteEditorProps {
  note: Note;
  /** Initial view mode — defaults to "document" (rendered presentation) */
  initialMode?: NoteViewMode;
}

/**
 * Note editor with autosave and three view modes.
 *
 * Modes:
 *   document — rendered markdown, the primary reading experience for humans
 *   edit     — markdown textarea with autosave (1.5s debounce)
 *   source   — raw markdown, read-only, labeled as "what the AI model receives"
 *
 * Autosave fires automatically after the debounce delay when content has changed.
 * Versioning remains intact — every save creates a new immutable version via the
 * update_note_and_create_version RPC (same as the manual save path).
 *
 * The explicit Save button is shown only when autosave is in error state.
 */
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

  const router = useRouter();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSnapshot = useRef({
    title: note.title,
    content: note.markdown_content,
    summary: note.summary ?? "",
    tagsInput: note.tags.join(", "),
    readHint: note.read_hint ?? "",
  });

  function parseTags(raw: string): string[] {
    return raw
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }

  const isDirty =
    title !== lastSavedSnapshot.current.title ||
    content !== lastSavedSnapshot.current.content ||
    summary !== lastSavedSnapshot.current.summary ||
    tagsInput !== lastSavedSnapshot.current.tagsInput ||
    readHint !== lastSavedSnapshot.current.readHint;

  const performSave = useCallback(async () => {
    if (!title.trim() || isSaving) return;
    setIsSaving(true);
    setAutosaveState("saving");
    setSaveError(null);

    const result = await saveNoteAction(note.id, {
      title,
      markdownContent: content,
      summary: summary.trim() || null,
      tags: parseTags(tagsInput),
      readHint: readHint.trim() || null,
    });

    setIsSaving(false);
    if (result.ok) {
      const now = new Date();
      setSavedAt(now);
      setAutosaveState("saved");
      lastSavedSnapshot.current = { title, content, summary, tagsInput, readHint };
      router.refresh();
      // Reset to idle after a few seconds
      setTimeout(() => {
        setAutosaveState((s: AutosaveState) => (s === "saved" ? "idle" : s));
      }, 4000);
    } else {
      setSaveError(result.error);
      setAutosaveState("error");
    }
  }, [note.id, title, content, summary, tagsInput, readHint, isSaving, router]);

  // Autosave debounce — fires after AUTOSAVE_DEBOUNCE_MS of inactivity
  useEffect(() => {
    if (!isDirty) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void performSave();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [title, content, summary, tagsInput, readHint, isDirty, performSave]);

  // Flush save on unmount if dirty
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const renderedHtml = renderMarkdown(content);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Title */}
      <div className="border-b border-border px-6 py-4">
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (mode === "document") setMode("edit");
          }}
          onFocus={() => {
            if (mode === "document") setMode("edit");
          }}
          placeholder="Note title"
          aria-label="Note title"
          className={cn(
            "w-full bg-transparent text-xl font-semibold tracking-tight text-foreground",
            "placeholder:text-muted-foreground focus:outline-none"
          )}
        />
      </div>

      {/* Mode toolbar */}
      <div className="flex items-center justify-between border-b border-border px-6 py-2">
        <div className="flex items-center gap-1" role="tablist" aria-label="View mode">
          <ModeButton
            mode="document"
            current={mode}
            icon={<Eye className="h-3 w-3" />}
            label="Document"
            onClick={() => setMode("document")}
          />
          <ModeButton
            mode="edit"
            current={mode}
            icon={<Pencil className="h-3 w-3" />}
            label="Edit"
            onClick={() => setMode("edit")}
          />
          <ModeButton
            mode="source"
            current={mode}
            icon={<Code2 className="h-3 w-3" />}
            label="Markdown"
            onClick={() => setMode("source")}
          />
        </div>

        <div className="flex items-center gap-2">
          <AutosaveStatus
            state={autosaveState}
            savedAt={savedAt}
            error={saveError}
          />
          {/* Manual save button — only shown on error to allow retry */}
          {autosaveState === "error" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void performSave()}
              disabled={isSaving}
              className="h-7 text-xs"
            >
              Retry
            </Button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {/* Document mode — rendered markdown for human reading */}
        {mode === "document" && (
          <div
            role="tabpanel"
            aria-label="Document view"
            className="h-full cursor-text"
            onClick={() => setMode("edit")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setMode("edit");
            }}
          >
            {content ? (
              <div
                className="prose prose-neutral dark:prose-invert max-w-none px-6 py-6 text-base leading-relaxed"
                // renderMarkdown output is sanitized by sanitize-html — see src/lib/markdown.ts
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            ) : (
              <div
                className="flex h-full items-center justify-center"
                aria-hidden="true"
              >
                <p className="text-sm text-muted-foreground">
                  Click to start writing…
                </p>
              </div>
            )}
          </div>
        )}

        {/* Edit mode — markdown textarea with autosave */}
        {mode === "edit" && (
          <textarea
            role="tabpanel"
            aria-label="Markdown editor"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write in Markdown…"
            spellCheck
            className={cn(
              "h-full min-h-full w-full resize-none bg-transparent px-6 py-6",
              "font-mono text-sm leading-relaxed text-foreground",
              "placeholder:text-muted-foreground focus:outline-none"
            )}
          />
        )}

        {/* Source mode — raw markdown, read-only, AI-facing */}
        {mode === "source" && (
          <div role="tabpanel" aria-label="Raw markdown source" className="h-full flex flex-col">
            <div className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-6 py-2">
              <Code2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                This is the raw markdown the AI model receives — unmodified source.
              </p>
            </div>
            <pre
              className={cn(
                "flex-1 overflow-auto px-6 py-6",
                "font-mono text-sm leading-relaxed text-foreground/80",
                "whitespace-pre-wrap break-words"
              )}
            >
              {content || <span className="text-muted-foreground italic">No content yet.</span>}
            </pre>
          </div>
        )}
      </div>

      {/* Metadata section (edit mode only) */}
      {mode === "edit" && (
        <div className="border-t border-border">
          <details className="group">
            <summary className="flex cursor-pointer items-center justify-between px-6 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
              Metadata
              <span className="text-[10px] uppercase tracking-wider group-open:hidden">
                expand
              </span>
            </summary>
            <div className="flex flex-col gap-3 px-6 pb-4 pt-2">
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-xs font-medium text-foreground/70"
                  htmlFor="note-summary"
                >
                  Summary
                </label>
                <Input
                  id="note-summary"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="One-line summary for context retrieval"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  className="text-xs font-medium text-foreground/70"
                  htmlFor="note-tags"
                >
                  Tags{" "}
                  <span className="font-normal text-muted-foreground">
                    (comma-separated)
                  </span>
                </label>
                <Input
                  id="note-tags"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="research, reading, ideas"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  className="text-xs font-medium text-foreground/70"
                  htmlFor="note-hint"
                >
                  Read hint{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional guidance for AI retrieval)
                  </span>
                </label>
                <Input
                  id="note-hint"
                  value={readHint}
                  onChange={(e) => setReadHint(e.target.value)}
                  placeholder="e.g. Read this before generating anything in the Research box"
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
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-fast",
        isActive
          ? "bg-accent text-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
