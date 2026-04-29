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
  initialAgentInstructions?: string | null;
}

export function BoxEditDialog({
  boxId,
  initialName,
  initialDescription,
  initialAgentInstructions,
}: BoxEditDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [agentInstructions, setAgentInstructions] = useState(
    initialAgentInstructions ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setName(initialName);
      setDescription(initialDescription ?? "");
      setAgentInstructions(initialAgentInstructions ?? "");
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
        agent_instructions: agentInstructions.trim() || null,
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

          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium text-foreground/80"
              htmlFor="box-edit-agent-instructions"
            >
              Atlas AI instructions{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <Textarea
              id="box-edit-agent-instructions"
              value={agentInstructions}
              onChange={(e) => setAgentInstructions(e.target.value)}
              placeholder="Rules or tone guidance Atlas AI should follow when working inside this box."
              rows={4}
              maxLength={4000}
              disabled={isPending}
            />
            <p className="text-[11px] text-muted-foreground">
              Auto-injected into every Atlas AI run scoped to this box. Great for
              style rules, required tags, or domain shorthand.
            </p>
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
