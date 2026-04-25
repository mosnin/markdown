"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, AlertTriangle, CheckCircle, X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  importIntoNoteAction,
  type NoteImportMode,
} from "@/app/app/notes/actions";

// ─── Note import dialog ───────────────────────────────────────────────────────

interface NoteImportDialogProps {
  noteId: string;
  noteTitle: string;
  onClose: () => void;
}

/**
 * Import a .md file into an existing note.
 *
 * replace — replaces the entire body with the imported file.
 * append  — appends the imported content after the current body, separated
 *           by a horizontal rule.
 *
 * The leading H1 heading ("# Title") is stripped from the import if it
 * matches common export conventions. A new version is created atomically
 * with change_origin = "import" so the import appears in version history.
 */
export function NoteImportDialog({
  noteId,
  noteTitle,
  onClose,
}: NoteImportDialogProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<NoteImportMode>("append");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setError(null);
    setSuccess(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.name.endsWith(".md")) {
      setFile(f);
      setError(null);
      setSuccess(false);
    } else if (f) {
      setError("Only .md files are supported for note import.");
    }
  }

  function handleImport() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const raw = await file.text();
      // Strip a leading "# Title" line — common in exported .md files
      const stripped = raw.replace(/^\s*#[^\n]*\n+/, "").trimStart();
      const result = await importIntoNoteAction(noteId, stripped, mode);
      if (result.ok) {
        setSuccess(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-background p-6 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Import into note</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Target:{" "}
              <span className="font-medium text-foreground/70">{noteTitle}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!success ? (
          <>
            {/* File drop zone */}
            <div
              className={cn(
                "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 cursor-pointer transition-colors",
                file
                  ? "border-border bg-muted/20"
                  : "border-border hover:border-muted-foreground/40 hover:bg-muted/10"
              )}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileText className="h-6 w-6 text-muted-foreground" />
              {file ? (
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">
                    Drop a .md file, or click to select
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Markdown only — .zip not supported here
                  </p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".md"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {/* Import mode */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Import mode
              </p>
              <div className="flex flex-col gap-2">
                {(
                  [
                    {
                      value: "append" as NoteImportMode,
                      label: "Append",
                      description:
                        "Add the imported content after the current note body, separated by a horizontal rule.",
                    },
                    {
                      value: "replace" as NoteImportMode,
                      label: "Replace",
                      description:
                        "Overwrite the entire note body with the imported content. The current body is saved as a prior version.",
                    },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
                      mode === opt.value
                        ? "border-foreground/30 bg-muted/30"
                        : "border-border hover:bg-muted/10"
                    )}
                  >
                    <input
                      type="radio"
                      name="import_mode"
                      value={opt.value}
                      checked={mode === opt.value}
                      onChange={() => setMode(opt.value)}
                      className="mt-0.5 shrink-0"
                    />
                    <div>
                      <p className="text-sm font-medium text-foreground">{opt.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {opt.description}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={!file || isPending}
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-medium transition-colors",
                  "bg-foreground text-background hover:bg-foreground/90",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {isPending ? "Importing…" : "Import"}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Success state */}
            <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                <p className="text-sm font-medium text-foreground">
                  {mode === "replace" ? "Note body replaced" : "Content appended"}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                A new version was created with{" "}
                <span className="font-medium">change origin: import</span>. The
                previous body is preserved in version history.
              </p>
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Note import button ───────────────────────────────────────────────────────

export function NoteImportButton({
  noteId,
  noteTitle,
}: {
  noteId: string;
  noteTitle: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Import into note"
        title="Import into note"
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-fast",
          "text-muted-foreground hover:text-foreground hover:bg-accent"
        )}
      >
        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Import</span>
      </button>
      {open && (
        <NoteImportDialog
          noteId={noteId}
          noteTitle={noteTitle}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
