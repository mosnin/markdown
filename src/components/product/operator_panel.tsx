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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

import { useOperatorProgress } from "@/lib/hooks/use_operator_run";
import {
  requestOperatorPlanAction,
  approveAndExecuteAction,
} from "@/app/app/workspace_operator/actions";
import type {
  OperatorPlanStep,
  OperatorRunPhase,
  OperatorProgressEvent,
} from "@/app/app/workspace_operator/types";

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

  const [isPlanPending, startPlanTransition] = useTransition();
  const [isExecPending, startExecTransition] = useTransition();

  const progressEvents = useOperatorProgress(
    phase === "executing" ? runId : null
  );
  const eventsEndRef = useRef<HTMLDivElement>(null);

  // -- derived ---------------------------------------------------------------
  const boxId = defaultBoxId ?? "";

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
  }

  function handleGeneratePlan() {
    if (!prompt.trim() || !boxId) return;

    setError(null);
    setPhase("planning");

    startPlanTransition(async () => {
      const res = await requestOperatorPlanAction({
        prompt: prompt.trim(),
        boxId,
      });

      if (!res.ok) {
        setError(res.error);
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
      const res = await approveAndExecuteAction({
        runId: runId!,
        branchId: branchId!,
        boxId,
        prompt: prompt.trim(),
        steps: steps.map((s) => ({
          index: s.index,
          description: s.description,
          tool: s.tool,
        })),
      });

      if (!res.ok) {
        setError(res.error);
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

  function handleCancel() {
    setPhase("cancelled");
    // After a beat, reset so the user can start fresh.
    setTimeout(reset, 0);
  }

  function handleStepDescriptionChange(index: number, value: string) {
    setSteps((prev) =>
      prev.map((s) => (s.index === index ? { ...s, description: value } : s))
    );
  }

  // -- render helpers --------------------------------------------------------

  function renderIdle() {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4">
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
          <span
            id="prompt-char-count"
            className={cn(
              "self-end text-xs tabular-nums",
              prompt.length >= MAX_PROMPT_LENGTH
                ? "text-destructive"
                : "text-muted-foreground"
            )}
          >
            {prompt.length}/{MAX_PROMPT_LENGTH}
          </span>
        </div>

        <Button
          disabled={!prompt.trim() || !boxId || isPlanPending}
          onClick={handleGeneratePlan}
          className="self-start"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Generate Plan
        </Button>
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

        <div className="flex items-center gap-2">
          <Button
            onClick={handleApproveAndRun}
            disabled={isExecPending || steps.length === 0}
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            Approve &amp; Run
          </Button>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
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

        <Button variant="outline" onClick={reset}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Try Again
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
      default:
        return renderIdle();
    }
  }

  // -- main render -----------------------------------------------------------

  return (
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
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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
