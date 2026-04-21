"use client";

import {
  type ChangeEvent,
  type DragEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { FileText, Sparkles, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { autoOrganizeWorkspaceAction } from "@/app/app/conversation/actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type ParsedItem = { title: string; markdown: string };

type Tab = "paste" | "files";

export interface BulkImportPanelProps {
  workspaceId: string;
  /**
   * Called after a successful organize so the parent can redirect or
   * refresh. Receives the result data so the parent can show a toast.
   */
  onOrganized?: (result: {
    boxes: Array<{ id: string; name: string; noteCount: number }>;
    totalNotes: number;
    summary: string;
  }) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_PASTE_CHARS = 200_000;
const MAX_FILES = 100;
const MAX_ITEMS = 200;
const ACCEPTED_EXT = /\.(md|txt|markdown)$/i;

// ─── Parse helpers ────────────────────────────────────────────────────────────

/**
 * Split a big markdown blob into individual notes.
 *
 * Splitting rules:
 *   1. Lines that are exactly "---" (with optional surrounding whitespace)
 *      separate top-level blocks.
 *   2. Within each block, h1 / h2 headings ("# " / "## ") start new notes.
 *   3. If no separators or headings are found, the whole text becomes one note
 *      with a title synthesized from the first non-empty line.
 */
export function parsePastedNotes(text: string): ParsedItem[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const blocks = splitOnSeparator(trimmed);

  const items: ParsedItem[] = [];
  for (const block of blocks) {
    const subItems = splitByHeading(block);
    for (const item of subItems) {
      if (item.markdown.trim() || item.title.trim()) {
        items.push(item);
      }
    }
  }

  return items;
}

function splitOnSeparator(text: string): string[] {
  return text
    .split(/^[\s]*---[\s]*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitByHeading(block: string): ParsedItem[] {
  const lines = block.split("\n");
  const segments: ParsedItem[] = [];
  let current: ParsedItem | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,2})\s+(.+)$/);
    if (headingMatch) {
      if (current) segments.push(current);
      current = { title: headingMatch[2].trim(), markdown: "" };
    } else {
      if (!current) {
        current = { title: "Untitled", markdown: "" };
      }
      current.markdown += line + "\n";
    }
  }
  if (current) segments.push(current);

  // If we never found a heading, derive a title from the first non-empty line.
  if (segments.length === 1 && segments[0].title === "Untitled") {
    const firstLine = block.split("\n").find((l) => l.trim()) ?? "";
    if (firstLine) {
      segments[0].title = firstLine.slice(0, 80).trim();
    }
  }

  return segments.map((s) => ({
    title: s.title || "Untitled",
    markdown: s.markdown.trim(),
  }));
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Empty-state bulk importer for a new workspace. Lets the user paste a big
 * markdown blob OR drop .md/.txt/.markdown files, parses them into
 * `{title, markdown}` items, and calls `autoOrganizeWorkspaceAction` which
 * embeds + clusters the notes into boxes.
 */
export function BulkImportPanel({
  workspaceId: _workspaceId,
  onOrganized,
}: BulkImportPanelProps) {
  const [tab, setTab] = useState<Tab>("paste");
  const [pasteText, setPasteText] = useState("");
  const [fileItems, setFileItems] = useState<ParsedItem[]>([]);
  const [fileWarning, setFileWarning] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Silence unused-prop lint without removing it — the prop is part of the
  // public API so callers can scope the import to a workspace even though
  // v1 of the action derives that server-side.
  void _workspaceId;

  const pasteItems = useMemo(
    () => parsePastedNotes(pasteText),
    [pasteText]
  );

  const items = tab === "paste" ? pasteItems : fileItems;
  const itemCount = items.length;
  const hasContent = itemCount > 0;

  // ── Paste handlers ────────────────────────────────────────────────────────

  function handlePasteChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    if (value.length > MAX_PASTE_CHARS) {
      setPasteText(value.slice(0, MAX_PASTE_CHARS));
      setError(
        `Paste truncated at ${MAX_PASTE_CHARS.toLocaleString()} characters — split into smaller batches.`
      );
      return;
    }
    setPasteText(value);
    if (error) setError(null);
  }

  // ── File handlers ─────────────────────────────────────────────────────────

  async function ingestFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const accepted: File[] = [];
    const rejectedNames: string[] = [];
    for (const f of files) {
      if (ACCEPTED_EXT.test(f.name)) {
        accepted.push(f);
      } else {
        rejectedNames.push(f.name);
      }
    }

    if (fileItems.length + accepted.length > MAX_FILES) {
      setFileWarning(
        `Too many files — cap is ${MAX_FILES}. Drop fewer files or clear existing ones.`
      );
      return;
    }

    const nextItems: ParsedItem[] = [];
    const failed: string[] = [];
    for (const f of accepted) {
      try {
        const text = await f.text();
        const title = f.name.replace(/\.(md|txt|markdown)$/i, "");
        nextItems.push({ title, markdown: text });
      } catch {
        failed.push(f.name);
      }
    }

    setFileItems((prev) => [...prev, ...nextItems]);

    const warnings: string[] = [];
    if (rejectedNames.length > 0) {
      warnings.push(
        `Skipped ${rejectedNames.length} unsupported file${rejectedNames.length === 1 ? "" : "s"} (only .md / .txt / .markdown are accepted).`
      );
    }
    if (failed.length > 0) {
      warnings.push(
        `Couldn't read ${failed.length} file${failed.length === 1 ? "" : "s"}: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}`
      );
    }
    setFileWarning(warnings.length > 0 ? warnings.join(" ") : null);
  }

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) void ingestFiles(e.target.files);
    // Allow selecting the same file again later
    e.target.value = "";
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files) void ingestFiles(e.dataTransfer.files);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
  }

  function removeFileItem(index: number) {
    setFileItems((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  function handleClear() {
    if (pending) return;
    setPasteText("");
    setFileItems([]);
    setFileWarning(null);
    setError(null);
  }

  async function handleOrganize() {
    if (itemCount === 0) return;
    if (itemCount > MAX_ITEMS) {
      setError(
        `Too many notes — cap is ${MAX_ITEMS} per import. Split into smaller batches.`
      );
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await autoOrganizeWorkspaceAction({ items });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onOrganized?.({
        boxes: result.data.boxes,
        totalNotes: result.data.totalNotes,
        summary: result.data.summary,
      });
      // Parent decides whether to refresh / redirect; we just clear local state.
      setPasteText("");
      setFileItems([]);
      setFileWarning(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex w-full max-w-3xl flex-col gap-5 rounded-xl border border-border bg-background p-6 shadow-sm">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-foreground/70" aria-hidden />
          <h2 className="text-base font-semibold text-foreground">
            Bring your notes — Pog will organize them
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Paste markdown or drop .md files. We embed each note, cluster by
          meaning, and create boxes automatically.
        </p>
      </div>

      {/* Tabs — simple toggle, styled inline to keep this file self-contained */}
      <div
        role="tablist"
        aria-label="Import source"
        className="inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-[3px]"
      >
        <button
          role="tab"
          aria-selected={tab === "paste"}
          type="button"
          disabled={pending}
          onClick={() => setTab("paste")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors",
            tab === "paste"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
            pending && "opacity-50 cursor-not-allowed"
          )}
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          Paste
        </button>
        <button
          role="tab"
          aria-selected={tab === "files"}
          type="button"
          disabled={pending}
          onClick={() => setTab("files")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors",
            tab === "files"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
            pending && "opacity-50 cursor-not-allowed"
          )}
        >
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Files
        </button>
      </div>

      {/* Tab content */}
      {tab === "paste" ? (
        <div className="flex flex-col gap-2">
          <Textarea
            rows={10}
            maxLength={MAX_PASTE_CHARS}
            placeholder={
              "Paste a big markdown blob here. Separate notes with a line of '---',\nor start each note with a '# ' or '## ' heading."
            }
            value={pasteText}
            onChange={handlePasteChange}
            disabled={pending}
            className="min-h-56 font-mono text-sm"
            aria-label="Paste markdown notes"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Tip: separate notes with{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.75em]">---</code>{" "}
              on its own line, or with{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.75em]">## </code>{" "}
              headings.
            </span>
            <span className="tabular-nums">
              {pasteText.trim().length === 0
                ? "empty — paste markdown above"
                : `${pasteItems.length} note${pasteItems.length === 1 ? "" : "s"} detected`}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => {
              if (!pending) fileInputRef.current?.click();
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !pending) {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            aria-label="Drop files or click to browse"
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
              pending
                ? "cursor-not-allowed opacity-60 border-border"
                : dragActive
                  ? "cursor-copy border-foreground/40 bg-muted/40"
                  : "cursor-pointer border-border hover:border-muted-foreground/40 hover:bg-muted/10"
            )}
          >
            <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="text-sm text-foreground">
              Drop .md or .txt files, or click to browse.
            </p>
            <p className="text-xs text-muted-foreground">
              Up to {MAX_FILES} files. .md · .txt · .markdown
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".md,.txt,.markdown"
              className="hidden"
              onChange={handleFileSelect}
              disabled={pending}
            />
          </div>

          {fileWarning && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {fileWarning}
            </div>
          )}

          {fileItems.length > 0 && (
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-md border border-border bg-muted/20 p-2">
              {fileItems.map((item, i) => (
                <div
                  key={`${item.title}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1 text-xs text-foreground/80"
                >
                  <FileText className="h-3 w-3 text-muted-foreground" aria-hidden />
                  <span className="max-w-[16rem] truncate">{item.title}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFileItem(i);
                    }}
                    disabled={pending}
                    aria-label={`Remove ${item.title}`}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            {fileItems.length === 0
              ? "No files yet — drop or browse to add some."
              : `${fileItems.length} note${fileItems.length === 1 ? "" : "s"} detected — ready to organize`}
          </div>
        </div>
      )}

      {/* Count summary (paste tab gets its own inline count; this is the
          top-level confirmation line spec'd in the UI shape) */}
      {hasContent && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-foreground">
          <Sparkles className="h-4 w-4 text-foreground/70" aria-hidden />
          <span>
            {itemCount} note{itemCount === 1 ? "" : "s"} detected from your input
          </span>
        </div>
      )}

      {/* Pending status */}
      {pending && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner size={14} />
          <span>Embedding {itemCount} notes and grouping by meaning…</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/10 p-2">
        <Button
          type="button"
          onClick={handleOrganize}
          disabled={!hasContent || pending}
          size="default"
        >
          {pending ? (
            <>
              <Spinner size={14} invert />
              Organizing your notes…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden />
              Organize into boxes
            </>
          )}
        </Button>
        <Button
          type="button"
          onClick={handleClear}
          disabled={pending || (!pasteText && fileItems.length === 0)}
          variant="ghost"
          size="default"
        >
          Clear
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
