"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatAbsoluteDate } from "@/lib/format_date";
import {
  computeEstimatedCostCents,
  FALLBACK_MODEL,
} from "@/server/services/workspace_operator_usage_service";
import type { WorkspaceOperatorRunRow } from "@/server/services/workspace_operator_runs_service";
import {
  rollbackOperatorRunAction,
  retryOperatorRunAction,
} from "@/app/app/workspace_operator/history_actions";

/**
 * Read-only header + plan + result + actions block for a single run.
 *
 * Pure client component. Pagination / data fetching live in the server
 * page; this just renders the props it was given and exposes
 * "Roll back" / "Retry" buttons that call the corresponding server
 * actions.
 */

interface OperatorRunPlanStep {
  index: number;
  description: string;
  tool: string;
  status?: string;
}

export interface OperatorRunDetailProps {
  run: WorkspaceOperatorRunRow;
  /** True iff at least one artifact note still exists (un-trashed). */
  hasLiveArtifacts: boolean;
}

export function OperatorRunDetail({
  run,
  hasLiveArtifacts,
}: OperatorRunDetailProps) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    type: "ok" | "error";
    message: string;
  } | null>(null);

  const cost = computeEstimatedCostCents(
    run.model ?? FALLBACK_MODEL,
    run.input_tokens ?? 0,
    run.output_tokens ?? 0
  );
  const totalTokens = (run.input_tokens ?? 0) + (run.output_tokens ?? 0);

  const planSteps = extractPlanSteps(run.plan);
  const summary = extractResultSummary(run.result) ?? run.error ?? null;

  // Spec: Roll back only when status=completed AND artifacts exist AND
  // not already rolled back (we proxy "already rolled back" via the
  // `hasLiveArtifacts` flag — if every note is already trashed there's
  // nothing left to roll back).
  const canRollback =
    run.status === "completed" &&
    (run.notes_created?.length ?? 0) > 0 &&
    hasLiveArtifacts;

  const canRetry =
    run.status === "failed" ||
    run.status === "cancelled" ||
    run.status === "completed";

  function handleRollback() {
    if (!canRollback || pending) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Roll back this run? Every note it created will be moved to the trash."
      )
    ) {
      return;
    }
    setFeedback(null);
    startTransition(async () => {
      const res = await rollbackOperatorRunAction(run.id);
      if (!res.ok) {
        setFeedback({ type: "error", message: res.error });
        return;
      }
      setFeedback({
        type: "ok",
        message: `Rolled back ${res.data.rolledBack} note${
          res.data.rolledBack === 1 ? "" : "s"
        }.`,
      });
    });
  }

  function handleRetry() {
    if (!canRetry || pending) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await retryOperatorRunAction(run.id);
      if (!res.ok) {
        const msg =
          typeof res.error === "string" ? res.error : res.error.message;
        setFeedback({ type: "error", message: msg });
        return;
      }
      setFeedback({
        type: "ok",
        message: "Retry started. Check the history list for the new run.",
      });
    });
  }

  function copyId() {
    if (typeof navigator === "undefined") return;
    void navigator.clipboard?.writeText(run.id).then(() => {
      setFeedback({ type: "ok", message: "Run id copied." });
    });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start gap-2">
            <CardTitle className="flex-1 break-words">{run.prompt}</CardTitle>
            <Badge variant="outline">{run.mode}</Badge>
            <StatusBadge status={run.status} />
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
          <Field label="Run id">
            <button
              type="button"
              onClick={copyId}
              className="font-mono text-foreground hover:underline"
              title="Copy run id"
            >
              {run.id}
            </button>
          </Field>
          <Field label="Model">{run.model ?? "—"}</Field>
          <Field label="Created">{formatAbsoluteDate(run.created_at)}</Field>
          <Field label="Updated">{formatAbsoluteDate(run.updated_at)}</Field>
          <Field label="Duration">{formatDuration(run.duration_ms)}</Field>
          <Field label="Tokens">
            {totalTokens > 0 ? totalTokens.toLocaleString("en-US") : "—"}
          </Field>
          <Field label="Cost">
            {cost > 0 ? `$${(cost / 100).toFixed(2)}` : "—"}
          </Field>
        </CardContent>
      </Card>

      {/* Plan */}
      {planSteps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {planSteps.map((step) => (
                <li
                  key={step.index}
                  className="flex items-start gap-2 rounded-lg border border-border p-2"
                >
                  <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    #{step.index + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-foreground">{step.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Tool: <span className="font-mono">{step.tool}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Result summary */}
      {summary && (
        <Card>
          <CardHeader>
            <CardTitle>
              {run.status === "failed" || run.status === "cancelled"
                ? "Error"
                : "Result"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={
                "text-sm " +
                (run.status === "failed"
                  ? "text-destructive"
                  : "text-foreground")
              }
            >
              {summary}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRollback}
            disabled={!canRollback || pending}
            title={
              canRollback
                ? "Move every note this run created to trash."
                : run.status !== "completed"
                  ? "Roll back is only available for completed runs."
                  : "Nothing to roll back — every artifact is already trashed."
            }
          >
            Roll back this run
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleRetry}
            disabled={!canRetry || pending}
            title={
              canRetry
                ? "Replay this prompt as a new run."
                : "Retry is only available for completed, failed, or cancelled runs."
            }
          >
            Retry this run
          </Button>
          {feedback && (
            <p
              className={
                "text-xs " +
                (feedback.type === "error"
                  ? "text-destructive"
                  : "text-muted-foreground")
              }
              role={feedback.type === "error" ? "alert" : undefined}
            >
              {feedback.message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xs text-foreground">{children}</span>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: WorkspaceOperatorRunRow["status"];
}) {
  let variant: "default" | "success" | "warning" | "destructive" | "secondary" | "info" =
    "secondary";
  if (status === "completed") variant = "success";
  else if (status === "failed") variant = "destructive";
  else if (status === "cancelled") variant = "warning";
  else if (status === "executing" || status === "planning") variant = "info";
  else if (status === "awaiting_approval") variant = "warning";
  return <Badge variant={variant}>{status.replace(/_/g, " ")}</Badge>;
}

function formatDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function extractPlanSteps(plan: unknown): OperatorRunPlanStep[] {
  if (!plan) return [];
  // The action layer stores either the OperatorPlanResult { steps: [] }
  // shape or the raw approved-steps array. Tolerate both.
  if (Array.isArray(plan)) {
    return plan
      .map((s, i) => normalizeStep(s, i))
      .filter((s): s is OperatorRunPlanStep => s !== null);
  }
  if (typeof plan === "object" && plan !== null) {
    const steps = (plan as { steps?: unknown }).steps;
    if (Array.isArray(steps)) {
      return steps
        .map((s, i) => normalizeStep(s, i))
        .filter((s): s is OperatorRunPlanStep => s !== null);
    }
  }
  return [];
}

function normalizeStep(s: unknown, fallbackIndex: number): OperatorRunPlanStep | null {
  if (typeof s !== "object" || s === null) return null;
  const obj = s as Record<string, unknown>;
  const description =
    typeof obj.description === "string" ? obj.description : null;
  if (!description) return null;
  return {
    index: typeof obj.index === "number" ? obj.index : fallbackIndex,
    description,
    tool: typeof obj.tool === "string" ? obj.tool : "(unknown)",
    status: typeof obj.status === "string" ? obj.status : undefined,
  };
}

function extractResultSummary(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const obj = result as Record<string, unknown>;
  if (typeof obj.summary === "string" && obj.summary.length > 0) {
    return obj.summary;
  }
  return null;
}
