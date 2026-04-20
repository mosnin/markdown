"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  Bot,
  Play,
  CheckCircle2,
  XCircle,
  ArrowRight,
  RotateCcw,
  Sparkles,
  BadgeAlert,
  Save,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useOperatorProgress } from "@/lib/hooks/use_operator_run";
import {
  requestOperatorPlanAction,
  approveAndExecuteAction,
  cancelRunAction,
  retryRunAction,
  listSavedPromptsAction,
  saveOperatorPromptAction,
  type ActionErrorQuotaExceeded,
} from "@/app/app/workspace_operator/actions";
import { loadOperatorQuotaAction } from "@/app/app/workspace_operator/quota_actions";
import type {
  OperatorPlanStep,
  OperatorRunPhase,
  OperatorProgressEvent,
  SavedOperatorPrompt,
  OperatorModel,
} from "@/app/app/workspace_operator/types";
import {
  OPERATOR_MODELS,
  DEFAULT_OPERATOR_MODEL,
  estimateOperatorRunCost,
  formatOperatorCostUsd,
} from "@/app/app/workspace_operator/types";
import type { WorkspacePlan } from "@/server/services/subscription_service";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OperatorPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultBoxId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOOL_BADGE_STYLES: Record<string, string> = {
  hybrid_search: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  draft_note: "bg-green-500/10 text-green-600 dark:text-green-400",
  analysis: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
};

function toolBadgeClass(tool: string): string {
  return TOOL_BADGE_STYLES[tool] ?? "bg-muted text-muted-foreground";
}

function stepStatusIcon(status: OperatorPlanStep["status"]) {
  switch (status) {
    case "completed":
      return (
        <CheckCircle2
          className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400"
          aria-label="Completed"
        />
      );
    case "in_progress":
      return <Spinner size={16} />;
    case "failed":
      return (
        <XCircle
          className="h-4 w-4 shrink-0 text-destructive"
          aria-label="Failed"
        />
      );
    case "pending":
    default:
      return (
        <div
          className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30"
          aria-label="Pending"
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MAX_PROMPT_LENGTH = 4000;

/** UI-facing slice of a structured quota-exceeded error — the panel
 *  persists this so its `quota_exceeded` phase can show tier / reset
 *  messaging without re-fetching. */
interface QuotaExceededState {
  tier: WorkspacePlan;
  limit: number | null;
  used: number;
  resetsAt: string;
  message: string;
}

/** Proactive pre-check snapshot used to disable the submit button. */
interface QuotaPreview {
  tier: WorkspacePlan;
  limit: number | null;
  used: number;
  remaining: number;
  allowed: boolean;
  resetsAt: string;
}

export function OperatorPanel({
  open,
  onOpenChange,
  defaultBoxId,
}: OperatorPanelProps) {
  // -- state -----------------------------------------------------------------
  const [phase, setPhase] = useState<OperatorRunPhase>("idle");
  const [prompt, setPrompt] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [steps, setSteps] = useState<OperatorPlanStep[]>([]);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    notes_created: string[];
    tool_calls: number;
    error?: string | null;
  } | null>(null);
  const [quotaExceeded, setQuotaExceeded] =
    useState<QuotaExceededState | null>(null);
  const [quotaPreview, setQuotaPreview] = useState<QuotaPreview | null>(null);

  // Wave 2 — model picker, saved prompts, save dialog, cancel-in-flight.
  const [selectedModel, setSelectedModel] = useState<OperatorModel>(
    DEFAULT_OPERATOR_MODEL
  );
  const [savedPrompts, setSavedPrompts] = useState<SavedOperatorPrompt[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const [isPlanPending, startPlanTransition] = useTransition();
  const [isExecPending, startExecTransition] = useTransition();

  const progressEvents = useOperatorProgress(
    phase === "executing" ? runId : null
  );
  const eventsEndRef = useRef<HTMLDivElement>(null);

  // -- quota preload ---------------------------------------------------------
  // Load the current quota when the panel opens so the submit button can
  // be preemptively disabled at limit with a tooltip. Re-fetch after a
  // completed run so a user who was at 4/5 sees the reflected 5/5.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadOperatorQuotaAction().then((res) => {
      if (cancelled || !res.ok || !res.quota) return;
      setQuotaPreview({
        tier: res.quota.tier,
        limit: res.quota.limit,
        used: res.quota.used,
        remaining: res.quota.remaining,
        allowed: res.quota.allowed,
        resetsAt:
          res.quota.resetsAt instanceof Date
            ? res.quota.resetsAt.toISOString()
            : String(res.quota.resetsAt),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, phase]);

  // Load saved prompts when the panel opens. Errors here are non-fatal —
  // the dropdown just shows nothing and the user can still type free-form.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listSavedPromptsAction().then((res) => {
      if (cancelled || !res.ok) return;
      setSavedPrompts(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // -- derived ---------------------------------------------------------------
  const boxId = defaultBoxId ?? "";

  // Pro/Business may opt into the bigger model. Free is locked to mini.
  const canUseLargeModel =
    quotaPreview?.tier === "pro" || quotaPreview?.tier === "business";

  // -- effects ---------------------------------------------------------------

  // Scroll event log to bottom when new events arrive.
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progressEvents.length]);

  // Update step statuses from realtime progress events.
  useEffect(() => {
    if (phase !== "executing" || progressEvents.length === 0) return;

    const latest = progressEvents[progressEvents.length - 1];

    if (latest.type === "step_start" && latest.step_index != null) {
      setSteps((prev) =>
        prev.map((s) =>
          s.index === latest.step_index ? { ...s, status: "in_progress" } : s
        )
      );
    }

    if (latest.type === "step_complete" && latest.step_index != null) {
      setSteps((prev) =>
        prev.map((s) =>
          s.index === latest.step_index ? { ...s, status: "completed" } : s
        )
      );
    }

    if (latest.type === "failed") {
      // Mark any in-progress step as failed.
      setSteps((prev) =>
        prev.map((s) =>
          s.status === "in_progress" ? { ...s, status: "failed" } : s
        )
      );
    }
  }, [phase, progressEvents]);

  // -- handlers --------------------------------------------------------------

  function reset() {
    setPhase("idle");
    setPrompt("");
    setRunId(null);
    setBranchId(null);
    setSteps([]);
    setSummary("");
    setError(null);
    setResult(null);
    setQuotaExceeded(null);
    setCancelling(false);
    setRetrying(false);
  }

  function handleGeneratePlan() {
    if (!prompt.trim() || !boxId) return;

    setError(null);
    setPhase("planning");

    startPlanTransition(async () => {
      const res = await requestOperatorPlanAction({
        prompt: prompt.trim(),
        boxId,
        model: selectedModel,
      });

      if (!res.ok) {
        if (isQuotaError(res.error)) {
          setQuotaExceeded({
            tier: res.error.tier,
            limit: res.error.limit,
            used: res.error.used,
            resetsAt: res.error.resetsAt,
            message: res.error.message,
          });
          setPhase("quota_exceeded");
          return;
        }
        setError(
          typeof res.error === "string"
            ? res.error
            : (res.error as { message: string }).message
        );
        setPhase("failed");
        return;
      }

      setRunId(res.data.run_id);
      setBranchId(res.data.branch_id);
      setSteps(res.data.steps);
      setSummary(res.data.summary);
      setPhase("awaiting_approval");
    });
  }

  function handleApproveAndRun() {
    if (!runId || !branchId || steps.length === 0) return;

    setError(null);
    setPhase("executing");

    startExecTransition(async () => {
      const editedSteps = steps.map((s) => ({
        index: s.index,
        description: s.description,
        tool: s.tool,
      }));
      const res = await approveAndExecuteAction({
        runId: runId!,
        branchId: branchId!,
        boxId,
        prompt: prompt.trim(),
        steps: editedSteps,
        editedSteps,
        model: selectedModel,
      });

      if (!res.ok) {
        if (isQuotaError(res.error)) {
          setQuotaExceeded({
            tier: res.error.tier,
            limit: res.error.limit,
            used: res.error.used,
            resetsAt: res.error.resetsAt,
            message: res.error.message,
          });
          setPhase("quota_exceeded");
          return;
        }
        setError(
          typeof res.error === "string"
            ? res.error
            : (res.error as { message: string }).message
        );
        setPhase("failed");
        return;
      }

      setResult({
        notes_created: res.data.notes_created,
        tool_calls: res.data.tool_calls,
        error: res.data.error,
      });

      if (res.data.status === "completed") {
        setPhase("completed");
      } else {
        setError(res.data.error ?? "Execution failed.");
        setPhase("failed");
      }
    });
  }

  /**
   * Real cancel — signals the Modal-side agent to stop via cancelRunAction.
   *
   * Optimistically transitions to "cancelled" after the action returns.
   * The Python operator polls cancellation_requested_at and writes the
   * final status; the panel's state is just a UI hint until then.
   *
   * If we have no runId yet (e.g. action hasn't returned the dispatch id),
   * fall back to a local-only reset — there's nothing server-side to stop.
   */
  function handleCancel() {
    if (!runId) {
      reset();
      return;
    }
    setCancelling(true);
    setError(null);
    cancelRunAction(runId)
      .then((res) => {
        if (!res.ok) {
          setError(actionErrorToString(res.error, "Failed to cancel."));
          setCancelling(false);
          return;
        }
        setPhase("cancelled");
        setCancelling(false);
        // Brief beat so the user sees the "cancelled" state, then reset.
        setTimeout(reset, 1200);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to cancel.");
        setCancelling(false);
      });
  }

  /**
   * Retry a failed run — mints a new runs row server-side via retryRunAction
   * and re-enters the planning/executing phase. The panel reseeds prompt +
   * model + branch from the new row so the user can also edit before
   * re-approving (when the original mode was "execute" or "plan").
   */
  function handleRetry() {
    if (!runId) {
      reset();
      return;
    }
    setRetrying(true);
    setError(null);
    retryRunAction(runId)
      .then((res) => {
        if (!res.ok) {
          setError(actionErrorToString(res.error, "Failed to retry."));
          setRetrying(false);
          return;
        }
        // Reseed from the new run row.
        setRunId(res.data.newRunId);
        setBranchId(res.data.branchId);
        setPrompt(res.data.prompt);
        if (res.data.model) {
          setSelectedModel(
            (OPERATOR_MODELS as readonly string[]).includes(res.data.model)
              ? (res.data.model as OperatorModel)
              : DEFAULT_OPERATOR_MODEL
          );
        }
        setSteps([]);
        setSummary("");
        setResult(null);
        setRetrying(false);
        // For plan/execute modes: drop back to idle so the user can re-plan.
        // For full mode: kick off a fresh plan automatically. Without
        // auto-dispatch we'd silently strand the new run id; explicit
        // re-plan keeps quota gating + audit consistent.
        if (res.data.mode === "full" || res.data.mode === "plan") {
          setPhase("idle");
        } else {
          setPhase("idle");
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to retry.");
        setRetrying(false);
      });
  }

  function handleStepDescriptionChange(index: number, value: string) {
    setSteps((prev) =>
      prev.map((s) => (s.index === index ? { ...s, description: value } : s))
    );
  }

  function handleSelectSavedPrompt(id: string) {
    if (!id) return;
    const found = savedPrompts.find((p) => p.id === id);
    if (found) setPrompt(found.prompt.slice(0, MAX_PROMPT_LENGTH));
  }

  function handleOpenSaveDialog() {
    if (!prompt.trim()) return;
    setSaveError(null);
    setSaveName("");
    setSaveDialogOpen(true);
  }

  function handleSaveTemplate() {
    if (!saveName.trim() || !prompt.trim()) {
      setSaveError("Name and prompt are required.");
      return;
    }
    setSaveError(null);
    saveOperatorPromptAction({
      name: saveName.trim(),
      prompt: prompt.trim(),
    }).then((res) => {
      if (!res.ok) {
        setSaveError(actionErrorToString(res.error, "Failed to save prompt."));
        return;
      }
      setSavedPrompts((prev) => [res.data, ...prev]);
      setSaveDialogOpen(false);
    });
  }

  // -- render helpers --------------------------------------------------------

  function renderIdle() {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4">
        {savedPrompts.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="operator-saved-prompt"
              className="text-xs font-medium text-muted-foreground"
            >
              Use saved prompt
            </label>
            <select
              id="operator-saved-prompt"
              value=""
              onChange={(e) => handleSelectSavedPrompt(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Use saved prompt"
            >
              <option value="">-- Pick a saved prompt --</option>
              {savedPrompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="operator-prompt"
            className="text-sm font-medium text-foreground"
          >
            What should the operator do?
          </label>
          <Textarea
            id="operator-prompt"
            placeholder="e.g. Research recent advances in transformer architectures and draft summary notes..."
            value={prompt}
            onChange={(e) =>
              setPrompt(e.target.value.slice(0, MAX_PROMPT_LENGTH))
            }
            maxLength={MAX_PROMPT_LENGTH}
            className="min-h-28 resize-none"
            aria-describedby="prompt-char-count"
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleOpenSaveDialog}
              disabled={!prompt.trim()}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="h-3 w-3" aria-hidden="true" />
              Save as template
            </button>
            <span
              id="prompt-char-count"
              className={cn(
                "text-xs tabular-nums",
                prompt.length >= MAX_PROMPT_LENGTH
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {prompt.length}/{MAX_PROMPT_LENGTH}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="operator-model"
            className="text-xs font-medium text-muted-foreground"
          >
            Model
          </label>
          <select
            id="operator-model"
            value={selectedModel}
            onChange={(e) => {
              const v = e.target.value as OperatorModel;
              if (v === "gpt-4.1" && !canUseLargeModel) return;
              setSelectedModel(v);
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Operator model"
          >
            {OPERATOR_MODELS.map((m) => {
              const locked = m === "gpt-4.1" && !canUseLargeModel;
              return (
                <option key={m} value={m} disabled={locked}>
                  {m}
                  {locked ? " — Pro+ only" : ""}
                </option>
              );
            })}
          </select>
        </div>

        {quotaPreview && (
          <p
            className={cn(
              "text-xs",
              quotaPreview.allowed
                ? "text-muted-foreground"
                : "text-destructive"
            )}
          >
            {quotaPreview.limit == null
              ? `Unlimited runs this month (${quotaPreview.tier} tier).`
              : `${quotaPreview.used} of ${quotaPreview.limit} runs used this month (${quotaPreview.tier} tier).`}
          </p>
        )}

        <Button
          disabled={
            !prompt.trim() ||
            !boxId ||
            isPlanPending ||
            (quotaPreview !== null && !quotaPreview.allowed)
          }
          onClick={handleGeneratePlan}
          className="self-start"
          title={
            quotaPreview !== null && !quotaPreview.allowed
              ? `You've used all ${quotaPreview.limit ?? "\u221e"} Operator runs on the ${quotaPreview.tier} tier this month. Resets on ${formatResetDate(quotaPreview.resetsAt)}.`
              : undefined
          }
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Generate Plan
        </Button>
      </div>
    );
  }

  function renderQuotaExceeded() {
    const q = quotaExceeded;
    if (!q) return null;
    const tierLabel =
      q.tier === "business"
        ? "Business"
        : q.tier === "pro"
          ? "Pro"
          : "Free";
    const canUpgrade = q.tier !== "business";
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 text-center">
        <BadgeAlert
          className="h-10 w-10 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">
            {q.limit == null
              ? `You've reached your Operator limit on the ${tierLabel} tier this month.`
              : `You've used all ${q.limit} Operator runs on the ${tierLabel} tier this month.`}
          </p>
          <p className="text-xs text-muted-foreground">
            Resets on {formatResetDate(q.resetsAt)}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canUpgrade && (
            <Button render={<Link href="/app/settings#settings-billing" />}>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
              Upgrade plan
            </Button>
          )}
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Close
          </Button>
        </div>
      </div>
    );
  }

  function renderPlanning() {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
        <Spinner size={24} />
        <p className="text-sm text-muted-foreground">Generating plan...</p>
      </div>
    );
  }

  function renderAwaitingApproval() {
    return (
      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
        {summary && (
          <p className="text-sm text-muted-foreground">{summary}</p>
        )}

        <Separator />

        <ScrollArea className="flex-1 -mx-4 px-4">
          <ol className="flex flex-col gap-2" aria-label="Plan steps">
            {steps.map((step) => (
              <li
                key={step.index}
                className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                  {step.index + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <input
                    type="text"
                    value={step.description}
                    onChange={(e) =>
                      handleStepDescriptionChange(step.index, e.target.value)
                    }
                    className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground focus:underline"
                    aria-label={`Step ${step.index + 1} description`}
                  />
                  <Badge
                    variant="outline"
                    className={cn("w-fit text-[10px]", toolBadgeClass(step.tool))}
                  >
                    {step.tool}
                  </Badge>
                </div>
              </li>
            ))}
          </ol>
        </ScrollArea>

        <div className="flex flex-col gap-2">
          <p
            className="text-xs text-muted-foreground"
            title="Worst-case estimate. Actual cost is usually lower because cached prompt tokens are billed at ~25% of the list rate and many steps complete in fewer than 500 output tokens."
          >
            Estimated max cost:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {formatOperatorCostUsd(
                estimateOperatorRunCost(
                  prompt.length,
                  steps.length,
                  selectedModel
                )
              )}
            </span>{" "}
            ({selectedModel})
          </p>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleApproveAndRun}
              disabled={isExecPending || steps.length === 0}
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Approve &amp; Run
            </Button>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling..." : "Cancel"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function renderExecuting() {
    return (
      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
        {/* Step progress */}
        <ol className="flex flex-col gap-1.5" aria-label="Execution progress">
          {steps.map((step) => (
            <li key={step.index} className="flex items-center gap-2 text-sm">
              {stepStatusIcon(step.status)}
              <span
                className={cn(
                  "truncate",
                  step.status === "completed" && "text-muted-foreground line-through"
                )}
              >
                {step.description}
              </span>
            </li>
          ))}
        </ol>

        <Separator />

        {/* Realtime event log */}
        <ScrollArea className="flex-1 -mx-4 px-4">
          <ul className="flex flex-col gap-1" aria-label="Operator events">
            {progressEvents.map((evt, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs text-muted-foreground"
              >
                <span className="shrink-0 tabular-nums text-[10px]">
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </span>
                <span>{formatEventDetail(evt)}</span>
              </li>
            ))}
          </ul>
          <div ref={eventsEndRef} />
        </ScrollArea>

        <Button
          variant="outline"
          size="sm"
          onClick={handleCancel}
          disabled={cancelling}
          className="self-start"
        >
          {cancelling ? "Cancelling..." : "Cancel run"}
        </Button>
      </div>
    );
  }

  function renderCompleted() {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 text-center">
        <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">
            Operator completed successfully
          </p>
          {result && (
            <p className="text-xs text-muted-foreground">
              {result.notes_created.length} note
              {result.notes_created.length !== 1 ? "s" : ""} drafted
              {" / "}
              {result.tool_calls} tool call
              {result.tool_calls !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {branchId && (
            <Button render={<Link href={`/app/branches/${branchId}`} />}>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
              Review Branch
            </Button>
          )}
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Run Again
          </Button>
        </div>
      </div>
    );
  }

  function renderFailed() {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 text-center">
        <XCircle className="h-10 w-10 text-destructive" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">
            Operator run failed
          </p>
          {error && (
            <p className="text-xs text-destructive/80">{error}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {runId && (
            <Button onClick={handleRetry} disabled={retrying}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {retrying ? "Retrying..." : "Retry"}
            </Button>
          )}
          <Button variant="outline" onClick={reset}>
            Start over
          </Button>
        </div>
      </div>
    );
  }

  function renderCancelled() {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 text-center">
        <XCircle className="h-10 w-10 text-amber-500" />
        <p className="text-sm font-medium text-foreground">Run cancelled</p>
        <Button variant="outline" onClick={reset}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Start over
        </Button>
      </div>
    );
  }

  // -- body selector ---------------------------------------------------------

  function renderBody() {
    switch (phase) {
      case "idle":
        return renderIdle();
      case "planning":
        return renderPlanning();
      case "awaiting_approval":
        return renderAwaitingApproval();
      case "executing":
        return renderExecuting();
      case "completed":
        return renderCompleted();
      case "failed":
        return renderFailed();
      case "cancelled":
        return renderCancelled();
      case "quota_exceeded":
        return renderQuotaExceeded();
      default:
        return renderIdle();
    }
  }

  // -- main render -----------------------------------------------------------

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => onOpenChange(o)}>
        <SheetContent
          side="right"
          className="flex w-full flex-col sm:max-w-[480px]"
          aria-describedby="operator-panel-desc"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" aria-hidden="true" />
              Workspace Operator
            </SheetTitle>
            <SheetDescription id="operator-panel-desc">
              Plan, review, and execute AI-powered workspace operations.
            </SheetDescription>
          </SheetHeader>

          <Separator />

          {renderBody()}
        </SheetContent>
      </Sheet>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription>
              Save this prompt for one-click reuse later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="operator-save-name"
              className="text-xs font-medium text-muted-foreground"
            >
              Name
            </label>
            <Input
              id="operator-save-name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value.slice(0, 80))}
              placeholder="e.g. Weekly competitive brief"
              maxLength={80}
            />
            {saveError && (
              <p className="text-xs text-destructive">{saveError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSaveDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveTemplate}
              disabled={!saveName.trim() || !prompt.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Narrow a raw action error to the structured quota-exceeded shape.
 * Actions can surface either a plain string or a structured object
 * (see `ActionErrorQuotaExceeded`); anything shaped like the latter
 * routes the UI into the quota_exceeded phase.
 */
function isQuotaError(
  err: unknown
): err is ActionErrorQuotaExceeded {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "quota_exceeded"
  );
}

/**
 * Coerce an `ActionResult` error (string | structured) into a flat string
 * suitable for `setError`. Quota errors carry a `.message`; plain string
 * errors pass through verbatim.
 */
export function actionErrorToString(
  err: string | ActionErrorQuotaExceeded | undefined | null,
  fallback: string
): string {
  if (err == null) return fallback;
  if (typeof err === "string") return err;
  return err.message ?? fallback;
}

function formatResetDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatEventDetail(evt: OperatorProgressEvent): string {
  switch (evt.type) {
    case "plan_ready":
      return "Plan ready";
    case "step_start":
      return `Starting step ${(evt.step_index ?? 0) + 1}${evt.detail ? `: ${evt.detail}` : ""}`;
    case "step_complete":
      return `Completed step ${(evt.step_index ?? 0) + 1}${evt.detail ? `: ${evt.detail}` : ""}`;
    case "tool_call":
      return `Tool call${evt.detail ? `: ${evt.detail}` : ""}`;
    case "note_drafted":
      return `Note drafted${evt.detail ? `: ${evt.detail}` : ""}`;
    case "completed":
      return "Run completed";
    case "failed":
      return `Failed${evt.detail ? `: ${evt.detail}` : ""}`;
    default:
      return evt.detail ?? evt.type;
  }
}
