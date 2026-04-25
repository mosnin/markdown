"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { BOX_TEMPLATES } from "@/lib/templates";

/**
 * Dialog for creating a new box.
 *
 * Critical path (what the user waits for):
 *   1. createBoxAction — auth check, slug generation, DB insert, audit write.
 *   2. router.push — navigate into the new box.
 *
 * Template application is intentionally NOT on the critical path.
 * If a template is selected, the template ID is passed as ?setup=<id> in the
 * URL so BoxTemplateSetup (rendered by the box page) can apply it in the
 * background while the user is already in the new box.
 *
 * This eliminates 800–1500ms of waiting that previously blocked navigation
 * when a template was selected.
 */
export function CreateBoxDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setName("");
    setDescription("");
    setSelectedTemplate("");
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
      // ── Critical path: create the box only ────────────────────────────────
      // Template application happens in the background on the box page via
      // BoxTemplateSetup so this action returns as fast as possible.
      const result = await createBoxAction(name, description || null);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const boxId = result.data.id;
      setOpen(false);
      reset();

      // Navigate immediately. If a template was selected, pass it as ?setup=
      // so the box page can apply it in the background without blocking navigation.
      router.push(
        selectedTemplate
          ? `/app/boxes/${boxId}?setup=${encodeURIComponent(selectedTemplate)}`
          : `/app/boxes/${boxId}`
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={<Button size="sm" className="gap-1.5" />}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        New box
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create box</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium text-foreground/80"
              htmlFor="box-name"
            >
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
            <label
              className="text-xs font-medium text-foreground/80"
              htmlFor="box-desc"
            >
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

          {/* Template picker */}
          <div className="flex flex-col gap-2" role="group" aria-labelledby="template-label">
            <p id="template-label" className="text-xs font-medium text-foreground/80">
              Start from template{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </p>
            <div className="grid grid-cols-1 gap-2">
              {BOX_TEMPLATES.map((template) => {
                const isSelected = selectedTemplate === template.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() =>
                      setSelectedTemplate(isSelected ? "" : template.id)
                    }
                    disabled={isPending}
                    aria-pressed={isSelected}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-fast",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border bg-background hover:bg-accent/40 text-foreground"
                    )}
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                        isSelected
                          ? "border-primary text-primary"
                          : "border-muted-foreground/40"
                      )}
                    >
                      {isSelected && (
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium leading-tight">{template.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                        {template.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
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
              {isPending ? "Creating…" : "Create box"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
