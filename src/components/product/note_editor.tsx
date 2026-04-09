"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { renderMarkdown } from "@/lib/markdown";
import { type Note } from "@/server/domain/types/note";
import { saveNoteAction } from "@/app/app/notes/actions";

interface NoteEditorProps {
  note: Note;
}

/**
 * Client-side note editor with source/preview toggle.
 *
 * Editing state is local. On save, calls saveNoteAction which
 * creates a new version atomically via the update_note_and_create_version RPC.
 *
 * Note: this component renders user-authored markdown with
 * dangerouslySetInnerHTML. Since notes are owner-authored content in
 * a single-user workspace, the XSS surface is acceptable in V1.
 */
export function NoteEditor({ note }: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.markdown_content);
  const [summary, setSummary] = useState(note.summary ?? "");
  const [tagsInput, setTagsInput] = useState(note.tags.join(", "));
  const [readHint, setReadHint] = useState(note.read_hint ?? "");
  const [mode, setMode] = useState<"source" | "preview">("source");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Track dirty state
  const isDirty =
    title !== note.title ||
    content !== note.markdown_content ||
    summary !== (note.summary ?? "") ||
    tagsInput !== note.tags.join(", ") ||
    readHint !== (note.read_hint ?? "");

  function parseTags(raw: string): string[] {
    return raw
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }

  function handleSave() {
    if (!title.trim()) return;
    setSaveError(null);
    startTransition(async () => {
      const result = await saveNoteAction(note.id, {
        title,
        markdownContent: content,
        summary: summary.trim() || null,
        tags: parseTags(tagsInput),
        readHint: readHint.trim() || null,
      });
      if (result.ok) {
        setSavedAt(new Date());
        router.refresh();
      } else {
        setSaveError(result.error);
      }
    });
  }

  const renderedHtml = renderMarkdown(content);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Title */}
      <div className="border-b border-border px-6 py-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Note title"
          className={cn(
            "w-full bg-transparent text-xl font-semibold tracking-tight text-foreground",
            "placeholder:text-muted-foreground focus:outline-none"
          )}
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-6 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode("source")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-fast",
              mode === "source"
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            )}
          >
            <Pencil className="h-3 w-3" />
            Source
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-fast",
              mode === "preview"
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            )}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
        </div>

        <div className="flex items-center gap-2">
          {savedAt && !isDirty && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="h-3 w-3" />
              Saved
            </span>
          )}
          {saveError && (
            <span className="text-xs text-destructive">{saveError}</span>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isPending || !isDirty || !title.trim()}
            variant={isDirty ? "default" : "outline"}
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Editor / Preview */}
      <div className="flex-1 overflow-auto">
        {mode === "source" ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Start writing in Markdown…"
            spellCheck
            className={cn(
              "h-full min-h-full w-full resize-none bg-transparent px-6 py-4",
              "font-mono text-sm leading-relaxed text-foreground",
              "placeholder:text-muted-foreground focus:outline-none"
            )}
          />
        ) : (
          <div
            className="prose prose-sm prose-neutral dark:prose-invert max-w-none px-6 py-4"
            // See component docstring re: dangerouslySetInnerHTML
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        )}
      </div>

      {/* Metadata section */}
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
              <label className="text-xs font-medium text-foreground/70" htmlFor="note-summary">
                Summary
              </label>
              <Input
                id="note-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="One-line summary for context retrieval"
                disabled={isPending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground/70" htmlFor="note-tags">
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
                disabled={isPending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground/70" htmlFor="note-hint">
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
                disabled={isPending}
              />
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
