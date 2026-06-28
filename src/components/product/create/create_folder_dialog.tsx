"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus } from "lucide-react";
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
import { createFolderAction } from "@/app/app/boxes/actions";

interface CreateFolderDialogProps {
  boxId: string;
  /** If provided, the new folder will be created inside this parent. */
  parentFolderId?: string | null;
  /**
   * Optional trigger styling override. When set (e.g. by the box header's
   * ••• overflow menu) it replaces the default bordered "New folder" button
   * so this can render as a full-width menu row.
   */
  triggerClassName?: string;
}

/**
 * Dialog for creating a folder inside a box (or inside another folder).
 */
export function CreateFolderDialog({
  boxId,
  parentFolderId,
  triggerClassName,
}: CreateFolderDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setName("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setError(null);
    startTransition(async () => {
      const result = await createFolderAction(
        boxId,
        name,
        parentFolderId ?? null
      );
      if (result.ok) {
        setOpen(false);
        reset();
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
          triggerClassName ? (
            <button type="button" className={triggerClassName} />
          ) : (
            <Button variant="outline" size="sm" className="gap-1.5 rounded-full" />
          )
        }
      >
        <FolderPlus className="h-3.5 w-3.5" />
        New folder
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create folder</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="folder-name">
              Folder name
            </label>
            <Input
              id="folder-name"
              placeholder="e.g. Reading notes, Synthesis"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              disabled={isPending}
            />
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          <DialogFooter showCloseButton>
            <Button type="submit" size="sm" disabled={isPending || !name.trim()}>
              {isPending ? "Creating…" : "Create folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
