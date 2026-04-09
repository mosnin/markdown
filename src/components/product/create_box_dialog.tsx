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
import { createBoxAction } from "@/app/app/boxes/actions";

/**
 * Dialog for creating a new box.
 * Calls the createBoxAction server action on submit.
 */
export function CreateBoxDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setName("");
    setDescription("");
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
      const result = await createBoxAction(name, description || null);
      if (result.ok) {
        setOpen(false);
        reset();
        router.refresh();
        router.push(`/app/boxes/${result.data.id}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm" className="gap-1.5" />
        }
      >
        <Plus className="h-3.5 w-3.5" />
        New box
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create box</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="box-name">
              Name
            </label>
            <Input
              id="box-name"
              placeholder="e.g. Research, Projects, Notes"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              disabled={isPending}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="box-desc">
              Description{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="box-desc"
              placeholder="What is this box for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isPending}
            />
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          <DialogFooter showCloseButton>
            <Button type="submit" size="sm" disabled={isPending || !name.trim()}>
              {isPending ? "Creating…" : "Create box"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
