"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookTemplate } from "lucide-react";
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
import { createTemplateFromNoteAction } from "@/app/app/boxes/template_actions";

interface SaveAsTemplateButtonProps {
  noteId: string;
  noteTitle: string;
}

/**
 * Button + dialog that saves the current note as a reusable template.
 * Placed on the note detail page toolbar next to existing actions.
 */
export function SaveAsTemplateButton({
  noteId,
  noteTitle,
}: SaveAsTemplateButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`Template from ${noteTitle}`);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setName(`Template from ${noteTitle}`);
      setDescription("");
      setError(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createTemplateFromNoteAction(
        noteId,
        name.trim(),
        description.trim() || undefined
      );
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <button
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-fast text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label="Save as template"
            title="Save as template"
          />
        }
      >
        <BookTemplate className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Save as template</span>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Create a reusable template from the current content of{" "}
            <span className="font-medium text-foreground/80">{noteTitle}</span>.
          </p>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium text-foreground/80"
              htmlFor="save-template-name"
            >
              Template name
            </label>
            <Input
              id="save-template-name"
              placeholder="Template name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              disabled={isPending}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium text-foreground/80"
              htmlFor="save-template-description"
            >
              Description{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="save-template-description"
              placeholder="Short description of this template"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isPending}
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
              disabled={isPending || !name.trim()}
            >
              {isPending ? "Saving..." : "Save template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
