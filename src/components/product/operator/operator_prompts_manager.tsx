"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatAbsoluteDate } from "@/lib/format_date";
import {
  createOperatorPromptAction,
  updateOperatorPromptAction,
  deleteOperatorPromptAction,
  reorderOperatorPromptsAction,
} from "@/app/app/workspace_operator/prompts_actions";
import type { OperatorPromptRow } from "@/server/services/operator_prompts_service";

/**
 * Prompts manager — list of saved prompts with new / edit / delete
 * affordances. Renders a single dialog used for both create and edit.
 *
 * The server page renders the initial rows; mutations splice the
 * returned row into local state so the UI updates without a router
 * refresh — the actions also call `revalidatePath` so a hard nav
 * shows the same list.
 */

const PREVIEW_CHARS = 100;

export interface OperatorPromptsManagerProps {
  initialPrompts: OperatorPromptRow[];
}

export function OperatorPromptsManager({
  initialPrompts,
}: OperatorPromptsManagerProps) {
  const [prompts, setPrompts] = useState<OperatorPromptRow[]>(initialPrompts);
  const [editing, setEditing] = useState<OperatorPromptRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>("");

  function handleSave(name: string, prompt: string) {
    setError("");
    startTransition(async () => {
      if (creating) {
        const res = await createOperatorPromptAction({ name, prompt });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setPrompts((p) => [res.data, ...p]);
        setCreating(false);
      } else if (editing) {
        const res = await updateOperatorPromptAction({
          id: editing.id,
          patch: { name, prompt },
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setPrompts((p) =>
          p.map((row) => (row.id === editing.id ? res.data : row))
        );
        setEditing(null);
      }
    });
  }

  function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= prompts.length) return;
    // Optimistically swap in local state so the UI responds instantly;
    // the server action below authoritatively re-fetches the ordered
    // list and we replace local state with that on success.
    const next = prompts.slice();
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    // Reassign sort_order top-down so consecutive moves stay stable
    // even if the server had gaps / ties in the previous ordering.
    const items = next.map((row, i) => ({ id: row.id, sort_order: i }));
    setPrompts(
      next.map((row, i) => ({ ...row, sort_order: i }))
    );
    setError("");
    startTransition(async () => {
      const res = await reorderOperatorPromptsAction({ items });
      if (!res.ok) {
        setError(res.error);
        // Roll back to the pre-swap list so the UI stays consistent
        // with the server.
        setPrompts(prompts);
        return;
      }
      setPrompts(res.data);
    });
  }

  function handleDelete(id: string) {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this saved prompt? This can't be undone.")
    ) {
      return;
    }
    setError("");
    startTransition(async () => {
      const res = await deleteOperatorPromptAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPrompts((p) => p.filter((row) => row.id !== id));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Save prompts you reuse with the Workspace Operator. They're private
          to you within this workspace.
        </p>
        <Button
          variant="default"
          size="sm"
          onClick={() => {
            setEditing(null);
            setError("");
            setCreating(true);
          }}
        >
          New prompt
        </Button>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {prompts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
          <p className="text-sm font-medium text-foreground">
            No saved prompts yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Save your most-used Operator prompts so you can re-run them with
            one click.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {prompts.map((row, index) => (
            <Card key={row.id} size="sm">
              <CardHeader>
                <CardTitle className="break-words">{row.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground line-clamp-3">
                  {truncate(row.prompt, PREVIEW_CHARS)}
                </p>
                <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>Updated {formatAbsoluteDate(row.updated_at)}</span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="icon-xs"
                      aria-label="Move prompt up"
                      title="Move up"
                      onClick={() => handleMove(index, -1)}
                      disabled={pending || index === 0}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-xs"
                      aria-label="Move prompt down"
                      title="Move down"
                      onClick={() => handleMove(index, 1)}
                      disabled={pending || index === prompts.length - 1}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setCreating(false);
                        setError("");
                        setEditing(row);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="xs"
                      onClick={() => handleDelete(row.id)}
                      disabled={pending}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <PromptDialog
        open={creating || editing !== null}
        initial={editing}
        pending={pending}
        onCancel={() => {
          setCreating(false);
          setEditing(null);
          setError("");
        }}
        onSave={handleSave}
      />
    </div>
  );
}

function PromptDialog({
  open,
  initial,
  pending,
  onCancel,
  onSave,
}: {
  open: boolean;
  initial: OperatorPromptRow | null;
  pending: boolean;
  onCancel: () => void;
  onSave: (name: string, prompt: string) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initial ? "Edit prompt" : "New saved prompt"}
          </DialogTitle>
          <DialogDescription>
            Give your prompt a short name. It only appears for you, in this
            workspace.
          </DialogDescription>
        </DialogHeader>
        <PromptDialogForm
          key={initial?.id ?? "new"}
          initial={initial}
          pending={pending}
          onCancel={onCancel}
          onSave={onSave}
        />
      </DialogContent>
    </Dialog>
  );
}

function PromptDialogForm({
  initial,
  pending,
  onCancel,
  onSave,
}: {
  initial: OperatorPromptRow | null;
  pending: boolean;
  onCancel: () => void;
  onSave: (name: string, prompt: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const canSave = name.trim().length > 0 && prompt.trim().length > 0 && !pending;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        onSave(name.trim(), prompt.trim());
      }}
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-foreground">Name</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="e.g. Weekly summary"
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-foreground">Prompt</span>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={4000}
          rows={6}
          placeholder="What should the Operator do? Use {{variable}} placeholders for reusable slots."
        />
        <span className="text-[11px] text-muted-foreground">
          Tip: wrap reusable slots in <code>{`{{`}name{`}}`}</code> — Atlas AI will
          prompt for values each time you pick this template.
        </span>
      </label>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" variant="default" size="sm" disabled={!canSave}>
          {pending ? "Saving..." : initial ? "Save" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "\u2026";
}
