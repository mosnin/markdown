"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
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
import {
  SKILL_AGENT_FORMATS,
  type SkillAgentFormat,
} from "@/server/domain/constants/object_constants";
import {
  createSkillInBoxAction,
  createReusableSkillAction,
} from "@/app/app/skills/actions";

// ─── Format options ───────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<SkillAgentFormat, string> = {
  markdown: "Markdown",
  json: "JSON",
  yaml: "YAML",
  typescript: "TypeScript",
  python: "Python",
};

const FORMAT_OPTIONS = SKILL_AGENT_FORMATS.map((f) => ({
  value: f,
  label: FORMAT_LABELS[f] ?? f,
}));

// ─── Props ────────────────────────────────────────────────────────────────────

interface SkillCreateDialogProps {
  /** Box context for box-local skills. Omit for workspace-level reusable skills. */
  boxId?: string;
  folderId?: string | null;
  /** If provided, renders as a custom trigger. Otherwise renders default button. */
  trigger?: React.ReactElement;
  /** Called after successful creation */
  onCreated?: (skillId: string) => void;
  /** Controlled open state */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** When true, forces reusable mode (no scope selector shown) */
  forceReusable?: boolean;
}

/**
 * Dialog for creating a new Skill.
 *
 * Supports two creation modes:
 * - Box-local: boxId provided, isReusable = false (default in box context)
 * - Workspace reusable: forceReusable = true or no boxId
 *
 * Fields: name, scope toggle (when applicable), canonical format,
 * description (optional), initial source content (optional).
 *
 * Canonical source format is chosen at creation time and cannot be changed later.
 */
export function SkillCreateDialog({
  boxId,
  folderId,
  trigger,
  onCreated,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  forceReusable = false,
}: SkillCreateDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;

  const [name, setName] = useState("");
  const [format, setFormat] = useState<SkillAgentFormat>("markdown");
  const [description, setDescription] = useState("");
  const [initialContent, setInitialContent] = useState("");
  const [isReusable, setIsReusable] = useState(forceReusable || !boxId);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setName("");
    setFormat("markdown");
    setDescription("");
    setInitialContent("");
    setIsReusable(forceReusable || !boxId);
    setNameError(null);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function validateName(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return "Name is required";
    if (trimmed.length > 500) return "Name must not exceed 500 characters";
    return null;
  }

  function handleNameChange(value: string) {
    setName(value);
    if (nameError) setNameError(validateName(value));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateName(name);
    if (err) { setNameError(err); return; }
    setNameError(null);
    setError(null);

    startTransition(async () => {
      const params = {
        name: name.trim(),
        canonicalFormat: format,
        description: description.trim() || null,
        initialContent: initialContent.trim() || undefined,
      };

      const result = (!isReusable && boxId)
        ? await createSkillInBoxAction(boxId, { ...params, folderId: folderId ?? null })
        : await createReusableSkillAction(params);

      if (result.ok) {
        setOpen(false);
        reset();
        onCreated?.(result.data.id);
        router.push(`/app/skills/${result.data.id}`);
      } else {
        setError(result.error);
      }
    });
  }

  const isControlled = controlledOpen !== undefined;
  const showScopeToggle = !!boxId && !forceReusable;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger render={trigger ?? <Button size="sm" variant="outline" className="gap-1.5" />}>
          {!trigger && (
            <>
              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              New skill
            </>
          )}
        </DialogTrigger>
      )}

      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New skill</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="skill-name">
              Name
            </label>
            <Input
              id="skill-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="My Skill"
              autoFocus
              required
              disabled={isPending}
              aria-describedby={nameError ? "skill-name-error" : undefined}
            />
            {nameError && (
              <p id="skill-name-error" className="text-xs text-destructive" role="alert">
                {nameError}
              </p>
            )}
          </div>

          {/* Scope toggle */}
          {showScopeToggle && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/80">Scope</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsReusable(false)}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs transition-fast ${
                    !isReusable
                      ? "border-ring bg-accent text-foreground font-medium"
                      : "border-border text-muted-foreground hover:bg-accent/40"
                  }`}
                >
                  Box local
                </button>
                <button
                  type="button"
                  onClick={() => setIsReusable(true)}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs transition-fast ${
                    isReusable
                      ? "border-ring bg-accent text-foreground font-medium"
                      : "border-border text-muted-foreground hover:bg-accent/40"
                  }`}
                >
                  Workspace reusable
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {isReusable
                  ? "Stored in the workspace Skills library. Can be attached into any box."
                  : "Stored inside this box only. Not accessible from other boxes."}
              </p>
            </div>
          )}

          {/* Canonical format */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="skill-format">
              Source format
            </label>
            <select
              id="skill-format"
              value={format}
              onChange={(e) => setFormat(e.target.value as SkillAgentFormat)}
              disabled={isPending}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              {FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              The canonical source format is permanent and cannot be changed after creation.
            </p>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="skill-description">
              Description{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="skill-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this skill does…"
              disabled={isPending}
            />
          </div>

          {/* Initial content */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="skill-content">
              Initial source content{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="skill-content"
              value={initialContent}
              onChange={(e) => setInitialContent(e.target.value)}
              disabled={isPending}
              rows={4}
              placeholder="Paste or type initial source…"
              spellCheck={false}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 leading-5"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive" role="alert">{error}</p>
          )}

          <DialogFooter showCloseButton>
            <Button type="submit" size="sm" disabled={isPending || !name.trim()}>
              {isPending ? "Creating…" : "Create skill"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
