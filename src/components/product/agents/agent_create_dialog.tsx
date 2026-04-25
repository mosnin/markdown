"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
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
  AGENT_TYPE,
  type SkillAgentFormat,
  type AgentType,
} from "@/server/domain/constants/object_constants";
import {
  createAgentInBoxAction,
  createReusableAgentAction,
} from "@/app/app/agents/actions";

// ─── Format options ───────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<SkillAgentFormat, string> = {
  markdown: "Markdown",
  json: "JSON",
  yaml: "YAML",
  xml: "XML",
  javascript: "JavaScript",
  shell: "Shell",
  plain_text: "Text",
  typescript: "TypeScript",
  python: "Python",
};

const FORMAT_OPTIONS = SKILL_AGENT_FORMATS.map((f) => ({
  value: f,
  label: FORMAT_LABELS[f] ?? f,
}));

// ─── Agent type options ───────────────────────────────────────────────────────

const AGENT_TYPE_OPTIONS = Object.entries(AGENT_TYPE).map(([, value]) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

// ─── Props ────────────────────────────────────────────────────────────────────

interface AgentCreateDialogProps {
  /** Box context for box-local agents. Omit for workspace-level reusable agents. */
  boxId?: string;
  folderId?: string | null;
  /** If provided, renders as a custom trigger. Otherwise renders default button. */
  trigger?: React.ReactElement;
  /** Called after successful creation */
  onCreated?: (agentId: string) => void;
  /** Controlled open state */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** When true, forces reusable mode (no scope selector shown) */
  forceReusable?: boolean;
}

/**
 * Dialog for creating a new Agent.
 *
 * Supports three creation modes:
 * - Box-local: boxId provided, isReusable = false (default in box context)
 * - Workspace reusable: forceReusable = true or no boxId
 *
 * Fields: name, canonical format, agent type (optional), model hint (optional),
 * system prompt (optional), description (optional), initial source content (optional).
 *
 * Canonical source format is chosen at creation time and cannot be changed later.
 */
export function AgentCreateDialog({
  boxId,
  folderId,
  trigger,
  onCreated,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  forceReusable = false,
}: AgentCreateDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;

  const [name, setName] = useState("");
  const [format, setFormat] = useState<SkillAgentFormat>("markdown");
  const [agentType, setAgentType] = useState<AgentType | "">("");
  const [modelHint, setModelHint] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
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
    setAgentType("");
    setModelHint("");
    setSystemPrompt("");
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
        agentType: agentType ? (agentType as AgentType) : null,
        modelHint: modelHint.trim() || null,
        systemPrompt: systemPrompt.trim() || null,
        description: description.trim() || null,
        initialContent: initialContent.trim() || undefined,
      };

      const result = (!isReusable && boxId)
        ? await createAgentInBoxAction(boxId, { ...params, folderId: folderId ?? null })
        : await createReusableAgentAction(params);

      if (result.ok) {
        setOpen(false);
        reset();
        onCreated?.(result.data.id);
        router.push(`/app/agents/${result.data.id}`);
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
              <Bot className="h-3.5 w-3.5" aria-hidden="true" />
              New agent
            </>
          )}
        </DialogTrigger>
      )}

      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="agent-name">
              Name
            </label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="My Research Agent"
              autoFocus
              required
              disabled={isPending}
              aria-describedby={nameError ? "agent-name-error" : undefined}
            />
            {nameError && (
              <p id="agent-name-error" className="text-xs text-destructive" role="alert">
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
                  ? "Stored in the workspace Agents library. Can be attached into any box."
                  : "Stored inside this box only. Not accessible from other boxes."}
              </p>
            </div>
          )}

          {/* Canonical format */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="agent-format">
              Source format
            </label>
            <select
              id="agent-format"
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

          {/* Agent type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="agent-type">
              Agent type{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <select
              id="agent-type"
              value={agentType}
              onChange={(e) => setAgentType(e.target.value as AgentType | "")}
              disabled={isPending}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <option value="">— No type —</option>
              {AGENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Model hint */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="agent-model">
              Model hint{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="agent-model"
              value={modelHint}
              onChange={(e) => setModelHint(e.target.value)}
              placeholder="e.g. claude-opus-4-6"
              disabled={isPending}
              className="font-mono text-sm"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="agent-description">
              Description{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="agent-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this agent does…"
              disabled={isPending}
            />
          </div>

          {/* System prompt */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="agent-sysprompt">
              System prompt{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="agent-sysprompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              disabled={isPending}
              rows={3}
              placeholder="You are a helpful agent that…"
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 leading-5"
            />
          </div>

          {/* Initial content */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="agent-content">
              Initial source content{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="agent-content"
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
              {isPending ? "Creating…" : "Create agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
