"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  MinusCircle,
  XCircle,
  GripVertical,
  Trash2,
  Plus,
  Save,
  Play,
  AlertTriangle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";

// ---------------------------------------------------------------------------
// Types (mirrored from the API contract)
// ---------------------------------------------------------------------------

export type RunPlanStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "skipped";

export interface RunPlanStep {
  index: number;
  description: string;
  tool: string | null;
  args_sketch?: unknown;
  status: RunPlanStepStatus;
}

export interface RunPlanRow {
  id: string;
  run_id: string;
  workspace_id: string;
  summary: string | null;
  steps: RunPlanStep[];
  approved: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PlanViewProps {
  runId: string;
  /** Current plan. `null` = no plan exists yet; pass in the fetched row once loaded. */
  plan: RunPlanRow | null;
  /** Whether the user can edit the plan (only before approval, for plan-first runs). */
  editable: boolean;
  /** Called after a successful approve. */
  onApproved?: () => void;
  /** Called after a successful edit (save). */
  onEdited?: (plan: RunPlanRow) => void;
}

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

interface PlanResponse {
  data?: { run_id: string; plan: RunPlanRow };
  error?: { message?: string } | string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stepStatusIcon(status: RunPlanStepStatus) {
  switch (status) {
    case "completed":
      return (
        <CheckCircle2
          className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400"
          aria-label="Completed"
        />
      );
    case "in_progress":
      return (
        <Loader2
          className="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400"
          aria-label="In progress"
        />
      );
    case "failed":
      return (
        <XCircle
          className="h-4 w-4 shrink-0 text-destructive"
          aria-label="Failed"
        />
      );
    case "skipped":
      return (
        <MinusCircle
          className="h-4 w-4 shrink-0 text-muted-foreground"
          aria-label="Skipped"
        />
      );
    case "pending":
    default:
      return (
        <Circle
          className="h-4 w-4 shrink-0 text-muted-foreground/50"
          aria-label="Pending"
        />
      );
  }
}

function formatApprovedAt(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function shortenId(id: string | null): string {
  if (!id) return "unknown";
  return id.length > 8 ? `${id.slice(0, 8)}` : id;
}

function reorder<T>(arr: T[], from: number, to: number): T[] {
  if (from === to) return arr;
  const copy = arr.slice();
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}

function reindexSteps(steps: RunPlanStep[]): RunPlanStep[] {
  return steps.map((s, i) => ({ ...s, index: i }));
}

function planEquals(
  a: { summary: string | null; steps: RunPlanStep[] },
  b: { summary: string | null; steps: RunPlanStep[] }
): boolean {
  if ((a.summary ?? "") !== (b.summary ?? "")) return false;
  if (a.steps.length !== b.steps.length) return false;
  for (let i = 0; i < a.steps.length; i++) {
    const s1 = a.steps[i];
    const s2 = b.steps[i];
    if (
      s1.index !== s2.index ||
      s1.description !== s2.description ||
      (s1.tool ?? null) !== (s2.tool ?? null) ||
      s1.status !== s2.status
    ) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PlanView({
  runId,
  plan,
  editable,
  onApproved,
  onEdited,
}: PlanViewProps) {
  const [summary, setSummary] = useState<string>(plan?.summary ?? "");
  const [steps, setSteps] = useState<RunPlanStep[]>(plan?.steps ?? []);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Sync local editable state when the incoming plan changes (e.g. parent refetch).
  useEffect(() => {
    setSummary(plan?.summary ?? "");
    setSteps(plan?.steps ?? []);
    setError(null);
  }, [plan?.id, plan?.updated_at, plan?.summary, plan?.steps]);

  const baseline = useMemo(
    () => ({ summary: plan?.summary ?? null, steps: plan?.steps ?? [] }),
    [plan?.id, plan?.updated_at, plan?.summary, plan?.steps]
  );

  const dirty = useMemo(
    () => !planEquals({ summary: summary || null, steps }, baseline),
    [summary, steps, baseline]
  );

  // The plan is only really editable if the caller allows it AND the plan
  // hasn't been approved yet. After approval, rows are read-only.
  const canEdit = editable && plan != null && !plan.approved;

  // -- handlers -------------------------------------------------------------

  const handleStepDescriptionChange = useCallback(
    (idx: number, value: string) => {
      setSteps((prev) =>
        prev.map((s, i) => (i === idx ? { ...s, description: value } : s))
      );
    },
    []
  );

  const handleDeleteStep = useCallback((idx: number) => {
    setSteps((prev) => reindexSteps(prev.filter((_, i) => i !== idx)));
  }, []);

  const handleAddStep = useCallback(() => {
    setSteps((prev) => [
      ...prev,
      {
        index: prev.length,
        description: "",
        tool: null,
        status: "pending",
      },
    ]);
  }, []);

  const handleDragStart = useCallback((idx: number) => {
    setDragIndex(idx);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, idx: number) => {
      if (dragIndex === null || dragIndex === idx) return;
      e.preventDefault();
    },
    [dragIndex]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, idx: number) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === idx) {
        setDragIndex(null);
        return;
      }
      setSteps((prev) => reindexSteps(reorder(prev, dragIndex, idx)));
      setDragIndex(null);
    },
    [dragIndex]
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent/operator/plan/${runId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          summary: summary || null,
          steps,
        }),
      });
      const body = (await res.json().catch(() => null)) as PlanResponse | null;
      if (!res.ok || !body?.data?.plan) {
        const msg =
          (body?.error && typeof body.error === "object"
            ? body.error.message
            : typeof body?.error === "string"
              ? body.error
              : null) ?? `Save failed (${res.status})`;
        throw new Error(msg);
      }
      onEdited?.(body.data.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save plan.");
    } finally {
      setSaving(false);
    }
  }, [plan, runId, summary, steps, onEdited]);

  const handleApprove = useCallback(async () => {
    if (!plan) return;
    setApproving(true);
    setError(null);
    try {
      // If there are unsaved changes, save first so the dispatched plan
      // reflects what the user sees on screen.
      if (dirty) {
        const saveRes = await fetch(`/api/agent/operator/plan/${runId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            summary: summary || null,
            steps,
          }),
        });
        const saveBody = (await saveRes.json().catch(() => null)) as
          | PlanResponse
          | null;
        if (!saveRes.ok) {
          const msg =
            (saveBody?.error && typeof saveBody.error === "object"
              ? saveBody.error.message
              : typeof saveBody?.error === "string"
                ? saveBody.error
                : null) ?? `Save failed (${saveRes.status})`;
          throw new Error(msg);
        }
        if (saveBody?.data?.plan) {
          onEdited?.(saveBody.data.plan);
        }
      }

      const res = await fetch(`/api/agent/operator/plan/${runId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | PlanResponse
          | null;
        const msg =
          (body?.error && typeof body.error === "object"
            ? body.error.message
            : typeof body?.error === "string"
              ? body.error
              : null) ?? `Approve failed (${res.status})`;
        throw new Error(msg);
      }
      onApproved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve plan.");
    } finally {
      setApproving(false);
    }
  }, [plan, runId, dirty, summary, steps, onApproved, onEdited]);

  // -- render ---------------------------------------------------------------

  if (plan === null) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center"
        aria-label="No plan"
      >
        <Circle
          className="h-8 w-8 text-muted-foreground/40"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-foreground">No plan</p>
        <p className="text-xs text-muted-foreground">
          Run with plan-first mode to generate one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Approved pill */}
      {plan.approved && (
        <div className="flex items-center gap-2">
          <Badge variant="success" className="gap-1">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            Approved by {shortenId(plan.approved_by)} at{" "}
            {formatApprovedAt(plan.approved_at)}
          </Badge>
        </div>
      )}

      {/* Summary */}
      {canEdit ? (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`plan-summary-${runId}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Summary
          </label>
          <Textarea
            id={`plan-summary-${runId}`}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Short description of what this plan does..."
            className="min-h-16 resize-none"
          />
        </div>
      ) : (
        plan.summary && (
          <p className="text-sm text-muted-foreground">{plan.summary}</p>
        )
      )}

      <Separator />

      {/* Steps */}
      <ol
        className="flex flex-col gap-2"
        aria-label="Plan steps"
        role="list"
      >
        {steps.length === 0 && !canEdit && (
          <li className="text-xs text-muted-foreground italic">
            No steps in this plan.
          </li>
        )}
        {steps.map((step, idx) => (
          <li
            key={`${step.index}-${idx}`}
            draggable={canEdit}
            onDragStart={canEdit ? () => handleDragStart(idx) : undefined}
            onDragOver={canEdit ? (e) => handleDragOver(e, idx) : undefined}
            onDrop={canEdit ? (e) => handleDrop(e, idx) : undefined}
            onDragEnd={canEdit ? handleDragEnd : undefined}
            className={cn(
              "group flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5 transition-colors",
              canEdit && "hover:border-border/80",
              dragIndex === idx && "opacity-50"
            )}
          >
            {canEdit && (
              <button
                type="button"
                aria-label={`Drag step ${idx + 1} to reorder`}
                className="mt-0.5 cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
                // The drag event is attached to the <li>; this handle is
                // purely affordance. Using `tabIndex={-1}` keeps keyboard
                // focus flowing to the text input.
                tabIndex={-1}
              >
                <GripVertical className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            <span className="mt-0.5 shrink-0">
              {stepStatusIcon(step.status)}
            </span>

            <span className="mt-0.5 shrink-0 w-6 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {idx + 1}.
            </span>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {canEdit ? (
                <Input
                  value={step.description}
                  onChange={(e) =>
                    handleStepDescriptionChange(idx, e.target.value)
                  }
                  placeholder="Describe this step..."
                  className="h-7 text-sm"
                  aria-label={`Step ${idx + 1} description`}
                />
              ) : (
                <span
                  className={cn(
                    "text-sm text-foreground",
                    step.status === "completed" &&
                      "text-muted-foreground line-through",
                    step.status === "skipped" &&
                      "text-muted-foreground/70 line-through"
                  )}
                >
                  {step.description || (
                    <em className="text-muted-foreground">(no description)</em>
                  )}
                </span>
              )}
            </div>

            {step.tool && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {step.tool}
              </Badge>
            )}

            {canEdit && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => handleDeleteStep(idx)}
                aria-label={`Delete step ${idx + 1}`}
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
      </ol>

      {/* Add step */}
      {canEdit && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddStep}
          className="self-start"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add step
        </Button>
      )}

      {/* Dirty warning */}
      {canEdit && dirty && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Unsaved changes — click Save to persist.
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {/* Footer actions */}
      {canEdit && (
        <div className="flex items-center gap-2">
          <Button
            onClick={handleApprove}
            disabled={approving || saving || steps.length === 0}
          >
            {approving ? (
              <Spinner size={14} invert />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
            {approving ? "Approving..." : "Approve plan"}
          </Button>
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={saving || approving || !dirty}
          >
            {saving ? (
              <Spinner size={14} />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
