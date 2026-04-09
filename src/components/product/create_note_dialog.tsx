"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
import { type Folder } from "@/server/domain/types/folder";
import { createNoteAction } from "@/app/app/boxes/actions";
import { NOTE_TEMPLATES } from "@/lib/templates";

interface CreateNoteDialogProps {
  boxId: string;
  folders: Folder[];
}

/**
 * Dialog for creating a new note inside a box.
 *
 * Supports an optional note starter template that pre-populates content.
 * On success, navigates to the new note's page.
 */
export function CreateNoteDialog({ boxId, folders }: CreateNoteDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setTitle("");
    setFolderId("");
    setTemplateId("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function handleTemplateChange(id: string) {
    setTemplateId(id);
    // Auto-fill title from template if title is still empty
    if (id && !title.trim()) {
      const t = NOTE_TEMPLATES.find((t) => t.id === id);
      if (t) setTitle(t.label);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    const template = NOTE_TEMPLATES.find((t) => t.id === templateId);

    setError(null);
    startTransition(async () => {
      const result = await createNoteAction(
        boxId,
        title,
        folderId || null,
        template?.kind ?? "note",
        template?.markdownContent
      );
      if (result.ok) {
        setOpen(false);
        reset();
        router.push(`/app/notes/${result.data.id}`);
      } else {
        setError(result.error);
      }
    });
  }

  // Sort folders by path_cache for natural hierarchical display
  const sortedFolders = [...folders].sort((a, b) =>
    a.path_cache.localeCompare(b.path_cache)
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        New note
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create note</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* Template picker */}
          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium text-foreground/80"
              htmlFor="note-template"
            >
              Starter template{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <select
              id="note-template"
              value={templateId}
              onChange={(e) => handleTemplateChange(e.target.value)}
              disabled={isPending}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <option value="">Blank note</option>
              {NOTE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            {templateId && (
              <p className="text-[11px] text-muted-foreground">
                {NOTE_TEMPLATES.find((t) => t.id === templateId)?.description}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium text-foreground/80"
              htmlFor="note-title"
            >
              Title
            </label>
            <Input
              id="note-title"
              placeholder="Note title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
              disabled={isPending}
            />
          </div>

          {folders.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label
                className="text-xs font-medium text-foreground/80"
                htmlFor="note-folder"
              >
                Folder{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <select
                id="note-folder"
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                disabled={isPending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                <option value="">Root (no folder)</option>
                {sortedFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.path_cache}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter showCloseButton>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !title.trim()}
            >
              {isPending ? "Creating…" : "Create note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
