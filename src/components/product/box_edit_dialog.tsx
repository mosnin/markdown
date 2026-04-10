"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { updateBoxAction } from "@/app/app/boxes/actions";

interface BoxEditDialogProps {
  boxId: string;
  initialName: string;
  initialDescription: string | null;
}

/**
 * Inline edit dialog for a box's name and description.
 * Renders a small pencil icon button as the trigger.
 */
export function BoxEditDialog({
  boxId,
  initialName,
  initialDescription,
}: BoxEditDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setName(initialName);
      setDescription(initialDescription ?? "");
      setError(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await updateBoxAction(boxId, {
        name: name.trim(),
        description: description.trim() || null,
      });
      if (result.ok) {
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
          />
        }
        aria-label="Edit box name and description"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit box</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium text-foreground/80"
              htmlFor="box-edit-name"
            >
              Name
            </label>
            <Input
              id="box-edit-name"
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
              htmlFor="box-edit-description"
            >
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <Textarea
              id="box-edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description of this box's purpose"
              rows={2}
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
              {isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
