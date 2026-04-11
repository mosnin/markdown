"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  SOURCE_FORMAT,
  type SourceFormat,
} from "@/server/domain/constants/object_constants";
import {
  CREATABLE_FILE_FORMATS,
  detectFormatFromFilename,
  extractFileExtension,
  getFormatInfo,
} from "@/lib/file_format_utils";
import { createFileInBoxAction } from "@/app/app/files/actions";

// ─── Format display labels for the select ────────────────────────────────────

const FORMAT_OPTIONS = CREATABLE_FILE_FORMATS.map((f) => ({
  value: f,
  label: getFormatInfo(f).label,
  extension: getFormatInfo(f).extension,
}));

interface FileCreateDialogProps {
  boxId: string;
  folderId?: string | null;
  /** If provided, renders a custom trigger. Otherwise renders a default button. */
  trigger?: React.ReactElement;
  /** Called after a file is successfully created */
  onCreated?: (fileId: string) => void;
  /** Controlled open state. When provided the trigger is not rendered. */
  open?: boolean;
  /** Controlled open change handler */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Dialog for creating a new File in a box or folder.
 *
 * Filename is the primary input. The canonical source format is auto-detected
 * from the extension as the user types, and can be overridden via select.
 *
 * Rules:
 * - Filename must not be empty or contain slashes
 * - Format detection is live (no submit required to see it)
 * - The initial content textarea is optional
 * - After creation: navigate to the new file route
 */
export function FileCreateDialog({
  boxId,
  folderId,
  trigger,
  onCreated,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: FileCreateDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [filename, setFilename] = useState("");
  const [format, setFormat] = useState<SourceFormat>(SOURCE_FORMAT.PLAIN_TEXT);
  const [initialContent, setInitialContent] = useState("");
  const [filenameError, setFilenameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Auto-detect format as user types filename
  useEffect(() => {
    if (!filename) return;
    const detected = detectFormatFromFilename(filename);
    if (detected) setFormat(detected);
  }, [filename]);

  function reset() {
    setFilename("");
    setFormat(SOURCE_FORMAT.PLAIN_TEXT);
    setInitialContent("");
    setFilenameError(null);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function validateFilename(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return "Filename is required";
    if (trimmed.length > 255) return "Filename must not exceed 255 characters";
    if (/[/\\]/.test(trimmed)) return "Filename must not contain slashes";
    return null;
  }

  function handleFilenameChange(value: string) {
    setFilename(value);
    if (filenameError) {
      setFilenameError(validateFilename(value));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateFilename(filename);
    if (err) {
      setFilenameError(err);
      return;
    }
    setFilenameError(null);
    setError(null);

    const info = getFormatInfo(format);
    const ext = extractFileExtension(filename) ?? info.extension;

    startTransition(async () => {
      const result = await createFileInBoxAction(boxId, {
        filename: filename.trim(),
        canonicalFormat: format,
        fileExtension: ext,
        sourceLanguage: info.language,
        mimeType: info.mimeType,
        folderId: folderId ?? null,
        initialContent: initialContent.trim() || undefined,
      });

      if (result.ok) {
        setOpen(false);
        reset();
        onCreated?.(result.data.id);
        router.push(`/app/files/${result.data.id}`);
      } else {
        setError(result.error);
      }
    });
  }

  const detectedFromFilename = filename ? detectFormatFromFilename(filename) : null;

  const isControlled = controlledOpen !== undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger render={trigger ?? <Button size="sm" variant="outline" className="gap-1.5" />}>
          {!trigger && (
            <>
              <File className="h-3.5 w-3.5" aria-hidden="true" />
              New file
            </>
          )}
        </DialogTrigger>
      )}

      <DialogContent>
        <DialogHeader>
          <DialogTitle>New file</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Filename */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="new-file-name">
              Filename
            </label>
            <Input
              id="new-file-name"
              value={filename}
              onChange={(e) => handleFilenameChange(e.target.value)}
              placeholder="config.json"
              autoFocus
              required
              disabled={isPending}
              spellCheck={false}
              className="font-mono text-sm"
              aria-describedby={filenameError ? "new-file-name-error" : undefined}
            />
            {filenameError && (
              <p id="new-file-name-error" className="text-xs text-destructive" role="alert">
                {filenameError}
              </p>
            )}
            {!filenameError && filename && detectedFromFilename && (
              <p className="text-[11px] text-muted-foreground">
                Format detected: {getFormatInfo(detectedFromFilename).label}
              </p>
            )}
          </div>

          {/* Format */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="new-file-format">
              Source format
            </label>
            <select
              id="new-file-format"
              value={format}
              onChange={(e) => setFormat(e.target.value as SourceFormat)}
              disabled={isPending}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              {FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} ({opt.extension})
                </option>
              ))}
            </select>
          </div>

          {/* Optional initial content */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="new-file-content">
              Initial content{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="new-file-content"
              value={initialContent}
              onChange={(e) => setInitialContent(e.target.value)}
              disabled={isPending}
              rows={4}
              placeholder="Paste or type initial content…"
              spellCheck={false}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 leading-5"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter showCloseButton>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !filename.trim()}
            >
              {isPending ? "Creating…" : "Create file"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
