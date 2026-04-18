"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createTemplateAction,
  updateTemplateAction,
  deleteTemplateAction,
} from "@/app/app/boxes/template_actions";

interface TemplateItem {
  id: string;
  name: string;
  description: string | null;
  markdown_content: string;
  tags: string[];
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface TemplateListClientProps {
  boxId: string;
  initialTemplates: TemplateItem[];
}

// ─── Create template dialog ──────────────────────────────────────────────────

function CreateTemplateDialog({ boxId }: { boxId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setName("");
    setDescription("");
    setContent("");
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
      const result = await createTemplateAction(
        boxId,
        name,
        description || null,
        content || ""
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
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        New template
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create note template</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium text-foreground/80"
              htmlFor="template-name"
            >
              Name
            </label>
            <Input
              id="template-name"
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
              htmlFor="template-description"
            >
              Description{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="template-description"
              placeholder="Short description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium text-foreground/80"
              htmlFor="template-content"
            >
              Markdown content
            </label>
            <textarea
              id="template-content"
              placeholder={"# Title\n\nTemplate content here.\nUse {{date}}, {{user}}, {{box_name}} for variables."}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={isPending}
              rows={8}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-y"
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
              {isPending ? "Creating..." : "Create template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit template dialog ────────────────────────────────────────────────────

function EditTemplateDialog({
  template,
  boxId,
}: {
  template: TemplateItem;
  boxId: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [content, setContent] = useState(template.markdown_content);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setName(template.name);
      setDescription(template.description ?? "");
      setContent(template.markdown_content);
      setError(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await updateTemplateAction(template.id, {
        name,
        description: description || null,
        markdown_content: content,
      });
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
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-fast"
            aria-label={`Edit template ${template.name}`}
          />
        }
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit template</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium text-foreground/80"
              htmlFor="edit-template-name"
            >
              Name
            </label>
            <Input
              id="edit-template-name"
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
              htmlFor="edit-template-description"
            >
              Description
            </label>
            <Input
              id="edit-template-description"
              placeholder="Short description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium text-foreground/80"
              htmlFor="edit-template-content"
            >
              Markdown content
            </label>
            <textarea
              id="edit-template-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={isPending}
              rows={8}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-y"
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
              {isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete button ───────────────────────────────────────────────────────────

function DeleteTemplateButton({
  templateId,
  templateName,
  boxId,
}: {
  templateId: string;
  templateName: string;
  boxId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    if (!confirm(`Delete template "${templateName}"? This cannot be undone.`)) {
      return;
    }
    startTransition(async () => {
      await deleteTemplateAction(templateId, boxId);
      router.refresh();
    });
  }

  return (
    <button
      onClick={handleDelete}
      disabled={isPending}
      className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-fast disabled:opacity-50"
      aria-label={`Delete template ${templateName}`}
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

// ─── Template list ───────────────────────────────────────────────────────────

export function TemplateListClient({
  boxId,
  initialTemplates,
}: TemplateListClientProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">
          {initialTemplates.length > 0
            ? `${initialTemplates.length} template${initialTemplates.length !== 1 ? "s" : ""}`
            : ""}
        </h2>
        <CreateTemplateDialog boxId={boxId} />
      </div>

      {initialTemplates.length > 0 && (
        <div className="flex flex-col gap-2">
          {initialTemplates.map((template) => (
            <div
              key={template.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-accent/30"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <FileText
                    className="h-4 w-4 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium text-foreground truncate">
                    {template.name}
                  </span>
                  {template.is_default && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] font-normal"
                    >
                      Default
                    </Badge>
                  )}
                </div>
                {template.description && (
                  <p className="pl-6 text-xs text-muted-foreground line-clamp-2">
                    {template.description}
                  </p>
                )}
                {template.tags.length > 0 && (
                  <div className="pl-6 flex flex-wrap gap-1 mt-0.5">
                    {template.tags.slice(0, 5).map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-[10px] font-normal"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <EditTemplateDialog template={template} boxId={boxId} />
                <DeleteTemplateButton
                  templateId={template.id}
                  templateName={template.name}
                  boxId={boxId}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
