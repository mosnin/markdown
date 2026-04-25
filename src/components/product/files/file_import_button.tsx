"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { importIntoFileAction } from "@/app/app/files/actions";

/**
 * Import-into-file button. Lives in the File page header.
 *
 * Opens a dialog that lets the user pick a mode (replace or append) and
 * upload a file. The upload is a plain text file; the server reads its
 * contents, writes them through updateFileContent, and creates a new
 * immutable version. Versioning, audit, and workspace ownership are
 * preserved by the existing service layer.
 *
 * Works for every file scope: box, folder, Skill child, Agent child,
 * box-local or workspace-level.
 */
export function FileImportButton({ fileId }: { fileId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("mode", mode);

    const uploaded = formData.get("file");
    if (!(uploaded instanceof File) || uploaded.size === 0) {
      setError("Select a file to import");
      return;
    }

    startTransition(async () => {
      const result = await importIntoFileAction(fileId, formData);
      if (result.ok) {
        setOpen(false);
        form.reset();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-fast",
          "text-muted-foreground hover:text-foreground hover:bg-accent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-label="Import content into file"
        title="Import content into this file"
      >
        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Import</span>
      </button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setError(null);
            formRef.current?.reset();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import into this file</DialogTitle>
          </DialogHeader>
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="flex flex-col gap-4"
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="text-xs font-medium text-muted-foreground">
                Import mode
              </legend>
              <label className="flex items-start gap-2 rounded-md border border-border bg-background p-3 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="replace"
                  checked={mode === "replace"}
                  onChange={() => setMode("replace")}
                  className="mt-0.5"
                  disabled={pending}
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    Replace
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Overwrite the current source with the uploaded content.
                    The prior version is preserved in version history.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-md border border-border bg-background p-3 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="append"
                  checked={mode === "append"}
                  onChange={() => setMode("append")}
                  className="mt-0.5"
                  disabled={pending}
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    Append
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Add the uploaded content to the end of the current file,
                    preserving everything that was there.
                  </span>
                </span>
              </label>
            </fieldset>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                File
              </span>
              <input
                type="file"
                name="file"
                required
                disabled={pending}
                className="block w-full rounded-md border border-input bg-background text-sm file:mr-3 file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
              />
              <span className="text-[11px] text-muted-foreground/70">
                Any text file up to 5&nbsp;MB. Binary content is not supported.
              </span>
            </label>
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <DialogFooter showCloseButton>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Importing…" : "Import"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
