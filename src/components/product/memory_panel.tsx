"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Brain,
  AlertTriangle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Types (mirrored from API contract)
// ---------------------------------------------------------------------------

export type AgentMemoryType =
  | "workspace_facts"
  | "user_preferences"
  | "recent_work"
  | "learned_schemas"
  | "project_context";

export interface AgentMemoryRow {
  id: string;
  workspace_id: string;
  memory_type: AgentMemoryType;
  title: string;
  content: string;
  relevance: number;
  created_by_run: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface MemoryPanelProps {
  workspaceId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEMORY_TYPES: readonly AgentMemoryType[] = [
  "workspace_facts",
  "user_preferences",
  "recent_work",
  "learned_schemas",
  "project_context",
] as const;

const MEMORY_TYPE_LABEL: Record<AgentMemoryType, string> = {
  workspace_facts: "Workspace facts",
  user_preferences: "User preferences",
  recent_work: "Recent work",
  learned_schemas: "Learned schemas",
  project_context: "Project context",
};

/**
 * Color tokens per memory type. Kept as tailwind class strings rather than
 * inline styles so theming still works (dark mode variants included).
 */
const MEMORY_TYPE_BADGE: Record<AgentMemoryType, string> = {
  workspace_facts:
    "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/20",
  user_preferences:
    "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/20",
  recent_work:
    "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/20",
  learned_schemas:
    "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/20",
  project_context:
    "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/20",
};

const MAX_TITLE = 200;
const MAX_CONTENT = 8000;

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

interface ListResponse {
  data?: { memories: AgentMemoryRow[] };
  error?: { message?: string } | string;
}

interface SingleResponse {
  data?: { memory: AgentMemoryRow };
  error?: { message?: string } | string;
}

interface DeleteResponse {
  data?: { deleted: boolean };
  error?: { message?: string } | string;
}

interface CreateMemoryInput {
  workspace_id: string;
  memory_type: AgentMemoryType;
  title: string;
  content: string;
  relevance: number;
}

type FilterValue = "all" | AgentMemoryType;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(
  err: { message?: string } | string | undefined,
  fallback: string
): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  return err.message ?? fallback;
}

interface FormState {
  memory_type: AgentMemoryType;
  title: string;
  content: string;
  relevance: string; // tracked as string to permit partial edits ("1.", "")
}

function emptyForm(): FormState {
  return {
    memory_type: "workspace_facts",
    title: "",
    content: "",
    relevance: "1.0",
  };
}

function formFromMemory(m: AgentMemoryRow): FormState {
  return {
    memory_type: m.memory_type,
    title: m.title,
    content: m.content,
    relevance: String(m.relevance),
  };
}

function parseRelevance(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 10) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MemoryPanel({ workspaceId }: MemoryPanelProps) {
  const [memories, setMemories] = useState<AgentMemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterValue>("all");
  const [search, setSearch] = useState("");

  // Editor dialog. `mode` discriminates create vs edit for the submit
  // handler; `editingId` is the row id when editing.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Delete confirmation dialog. Holds the target row so the confirm
  // message can mention its title.
  const [deleteTarget, setDeleteTarget] = useState<AgentMemoryRow | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // -- load on mount / workspace change -------------------------------------

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/agent/memories?workspace_id=${encodeURIComponent(workspaceId)}`,
        { credentials: "same-origin" }
      );
      const body = (await res.json().catch(() => null)) as ListResponse | null;
      if (!res.ok || !body?.data?.memories) {
        throw new Error(
          errorMessage(body?.error, `Load failed (${res.status})`)
        );
      }
      setMemories(body.data.memories);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load memories."
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // -- filtering ------------------------------------------------------------

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return memories.filter((m) => {
      if (filter !== "all" && m.memory_type !== filter) return false;
      if (q.length > 0) {
        const hay = `${m.title}\n${m.content}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [memories, filter, search]);

  // -- editor handlers ------------------------------------------------------

  const openCreate = useCallback(() => {
    setMode("create");
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((memory: AgentMemoryRow) => {
    setMode("edit");
    setEditingId(memory.id);
    setForm(formFromMemory(memory));
    setFormError(null);
    setDialogOpen(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    const title = form.title.trim();
    const content = form.content.trim();
    if (!title) {
      setFormError("Title is required.");
      return;
    }
    if (!content) {
      setFormError("Content is required.");
      return;
    }
    if (title.length > MAX_TITLE) {
      setFormError(`Title must be ${MAX_TITLE} characters or fewer.`);
      return;
    }
    if (content.length > MAX_CONTENT) {
      setFormError(`Content must be ${MAX_CONTENT} characters or fewer.`);
      return;
    }
    const relevance = parseRelevance(form.relevance);
    if (relevance === null) {
      setFormError("Relevance must be a number between 0 and 10.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      if (mode === "create") {
        const payload: CreateMemoryInput = {
          workspace_id: workspaceId,
          memory_type: form.memory_type,
          title,
          content,
          relevance,
        };
        const res = await fetch("/api/agent/memories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });
        const body = (await res.json().catch(() => null)) as
          | SingleResponse
          | null;
        if (!res.ok || !body?.data?.memory) {
          throw new Error(
            errorMessage(body?.error, `Create failed (${res.status})`)
          );
        }
        setMemories((prev) => [body.data!.memory, ...prev]);
      } else if (editingId) {
        const res = await fetch(`/api/agent/memories/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ title, content, relevance }),
        });
        const body = (await res.json().catch(() => null)) as
          | SingleResponse
          | null;
        if (!res.ok || !body?.data?.memory) {
          throw new Error(
            errorMessage(body?.error, `Update failed (${res.status})`)
          );
        }
        const updated = body.data.memory;
        setMemories((prev) =>
          prev.map((m) => (m.id === updated.id ? updated : m))
        );
      }
      setDialogOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSubmitting(false);
    }
  }, [mode, editingId, form, workspaceId]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/agent/memories/${deleteTarget.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const body = (await res.json().catch(() => null)) as
        | DeleteResponse
        | null;
      if (!res.ok || !body?.data?.deleted) {
        throw new Error(
          errorMessage(body?.error, `Delete failed (${res.status})`)
        );
      }
      setMemories((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget]);

  // -- render ---------------------------------------------------------------

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Header: title + add */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Brain className="h-4 w-4" aria-hidden="true" />
          Agent memories
        </h2>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          New memory
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or content..."
          className="h-8 pl-8 text-sm"
          aria-label="Search memories"
        />
      </div>

      {/* Filter chips */}
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Filter by memory type"
      >
        <FilterChip
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label="All"
          count={memories.length}
        />
        {MEMORY_TYPES.map((t) => (
          <FilterChip
            key={t}
            active={filter === t}
            onClick={() => setFilter(t)}
            label={MEMORY_TYPE_LABEL[t]}
            count={memories.filter((m) => m.memory_type === t).length}
            colorClass={MEMORY_TYPE_BADGE[t]}
          />
        ))}
      </div>

      {/* Body */}
      <ScrollArea className="flex-1 -mx-1 px-1">
        {loading && (
          <div className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
            <Spinner size={16} />
            Loading memories...
          </div>
        )}

        {!loading && loadError && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <AlertTriangle
              className="h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span className="flex-1">{loadError}</span>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void reload()}
            >
              Retry
            </Button>
          </div>
        )}

        {!loading && !loadError && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <Brain
              className="h-8 w-8 text-muted-foreground/40"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-foreground">
              {memories.length === 0
                ? "No memories yet"
                : "No memories match your filters"}
            </p>
            <p className="text-xs text-muted-foreground">
              {memories.length === 0
                ? "The agent will create them as you use it, or you can add facts manually."
                : "Try a different filter or search term."}
            </p>
          </div>
        )}

        {!loading && !loadError && filtered.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Memories">
            {filtered.map((m) => (
              <MemoryCard
                key={m.id}
                memory={m}
                onEdit={() => openEdit(m)}
                onDelete={() => {
                  setDeleteError(null);
                  setDeleteTarget(m);
                }}
              />
            ))}
          </ul>
        )}
      </ScrollArea>

      {/* Editor dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === "create" ? "New memory" : "Edit memory"}
            </DialogTitle>
            <DialogDescription>
              {mode === "create"
                ? "Add a fact or preference the agent should recall across runs."
                : "Update this memory. Changes apply to future runs."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {mode === "create" && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="memory-type"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Type
                </label>
                <select
                  id="memory-type"
                  value={form.memory_type}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      memory_type: e.target.value as AgentMemoryType,
                    }))
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={submitting}
                >
                  {MEMORY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {MEMORY_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="memory-title"
                className="text-xs font-medium text-muted-foreground"
              >
                Title
              </label>
              <Input
                id="memory-title"
                value={form.title}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    title: e.target.value.slice(0, MAX_TITLE),
                  }))
                }
                maxLength={MAX_TITLE}
                placeholder="e.g. Preferred citation style"
                disabled={submitting}
              />
              <span className="self-end text-[10px] tabular-nums text-muted-foreground">
                {form.title.length}/{MAX_TITLE}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="memory-content"
                className="text-xs font-medium text-muted-foreground"
              >
                Content
              </label>
              <Textarea
                id="memory-content"
                value={form.content}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    content: e.target.value.slice(0, MAX_CONTENT),
                  }))
                }
                maxLength={MAX_CONTENT}
                placeholder="The fact or preference the agent should remember..."
                className="min-h-24"
                disabled={submitting}
              />
              <span className="self-end text-[10px] tabular-nums text-muted-foreground">
                {form.content.length}/{MAX_CONTENT}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="memory-relevance"
                className="text-xs font-medium text-muted-foreground"
              >
                Relevance (0–10)
              </label>
              <Input
                id="memory-relevance"
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={form.relevance}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    relevance: e.target.value,
                  }))
                }
                className="w-28 tabular-nums"
                disabled={submitting}
              />
            </div>

            {formError && (
              <p
                role="alert"
                className="text-xs text-destructive"
              >
                {formError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Spinner size={14} invert />}
              {mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete memory?</DialogTitle>
            <DialogDescription>
              This permanently removes{" "}
              <span className="font-medium text-foreground">
                &ldquo;{deleteTarget?.title}&rdquo;
              </span>
              . The agent will no longer recall it.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-xs text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting && <Spinner size={14} />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  colorClass?: string;
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  colorClass,
}: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
        active
          ? cn(
              "border-foreground/30 text-foreground",
              colorClass ?? "bg-muted"
            )
          : "border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

interface MemoryCardProps {
  memory: AgentMemoryRow;
  onEdit: () => void;
  onDelete: () => void;
}

function MemoryCard({ memory, onEdit, onDelete }: MemoryCardProps) {
  return (
    <li className="group relative flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3 transition-colors hover:border-border/80">
      <div className="flex items-start justify-between gap-2">
        <Badge
          variant="outline"
          className={cn("text-[10px]", MEMORY_TYPE_BADGE[memory.memory_type])}
        >
          {MEMORY_TYPE_LABEL[memory.memory_type]}
        </Badge>
        <div className="flex items-center gap-1">
          <span
            className="text-[10px] tabular-nums text-muted-foreground"
            title="Relevance score"
          >
            {memory.relevance.toFixed(1)}
          </span>
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onEdit}
              aria-label={`Edit ${memory.title}`}
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onDelete}
              aria-label={`Delete ${memory.title}`}
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      <h3
        className="truncate text-sm font-semibold text-foreground"
        title={memory.title}
      >
        {memory.title}
      </h3>

      <p
        className="line-clamp-2 text-xs text-muted-foreground"
        title={memory.content}
      >
        {memory.content}
      </p>
    </li>
  );
}
