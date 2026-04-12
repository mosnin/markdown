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
} from "@/components/ui/dialog";
import { createWorkspaceAction } from "./actions";

/**
 * Header-level "New workspace" button. Opens a dialog, calls
 * createWorkspaceAction on submit, and routes to /app on success
 * (which will render the newly created workspace because the action
 * made it active).
 */
export function CreateWorkspaceButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createWorkspaceAction(name.trim());
      if (result.ok) {
        setOpen(false);
        setName("");
        router.push("/app");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="text-xs"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        New workspace
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setName("");
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Input
              placeholder="e.g. Personal, Work, Research"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              disabled={pending}
            />
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              A fresh container for boxes, notes, files, skills, and agents.
              The new workspace becomes active immediately.
            </p>
            <DialogFooter showCloseButton>
              <Button
                type="submit"
                size="sm"
                disabled={pending || !name.trim()}
              >
                {pending ? "Creating…" : "Create workspace"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
