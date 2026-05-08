"use client";

import { type RefObject } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeAlert,
  CheckCircle2,
  Maximize2,
  RotateCcw,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { OperatorActivityPanel } from "@/components/product/operator/operator_activity_panel";
import { OperatorSessionHistory } from "@/components/product/operator/operator_session_history";
import {
  estimateOperatorRunCost,
  formatOperatorCostUsd,
  type OperatorModel,
  type OperatorPlanStep,
  type OperatorProgressEvent,
  type OperatorRunPhase,
} from "@/app/app/workspace_operator/types";
import type { WorkspacePlan } from "@/server/services/subscription_service";

// ---------------------------------------------------------------------------
// Operator transcript — the chat scrollback for the operator panel.
//
// Renders the right-pane (or full-width on `mode="page"`) message stack:
//
//   - the active session history (prior runs in this thread)
//   - the current phase view: planning spinner, awaiting-approval plan
//     (with editable steps), live execution activity panel, terminal
//     completed / failed / cancelled states, plus the quota_exceeded
//     pricing nudge.
//
// All step editing, approve, retry, cancel, and navigation are forwarded
// to the parent (orchestrator). The transcript itself owns no state; it
// is a pure projection of the orchestrator's `phase` machine.
// ---------------------------------------------------------------------------

const TOOL_BADGE_STYLES: Record<string, string> = {
  hybrid_search: "bg-info/10 text-info border-info/25",
  draft_note: "bg-success/10 text-success border-success/25",
  analysis: "bg-brand/10 text-foreground border-brand/30",
};

function toolBadgeClass(tool: string): string {
  return TOOL_BADGE_STYLES[tool] ?? "bg-muted text-muted-foreground border-border";
}

function stepStatusIcon(status: OperatorPlanStep["status"]) {
  switch (status) {
    case "completed":
      return (
        <CheckCircle2
          className="h-4 w-4 shrink-0 text-success"
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

export interface QuotaExceededState {
  tier: WorkspacePlan;
  limit: number | null;
  used: number;
  resetsAt: string;
  message: string;
}

export interface OperatorTranscriptProps {
  phase: OperatorRunPhase;
  prompt: string;
  steps: OperatorPlanStep[];
  summary: string;
  error: string | null;
  result: {
    notes_created: string[];
    tool_calls: number;
    error?: string | null;
  } | null;
  runId: string | null;
  branchId: string | null;
  selectedModel: OperatorModel;
  liveTail: OperatorProgressEvent[];
  isExecPending: boolean;
  cancelling: boolean;
  retrying: boolean;
  isActivePhase: boolean;

  /** Session-history (this thread) hookup. */
  activeSessionId: string | null;
  sessionHistoryRefreshKey: number;

  /** Quota-exceeded snapshot (only consulted when phase === quota_exceeded). */
  quotaExceeded: QuotaExceededState | null;

  /**
   * When true, suppress the inline Approve/Cancel/Retry buttons inside
   * each phase view — the parent (orchestrator) is rendering an
   * `<OperatorSteerBar>` underneath, so duplicating the controls would
   * violate the "one primary action per region" rule.
   */
  hideInlineActions?: boolean;

  /** Step editing during awaiting_approval. */
  onStepDescriptionChange: (index: number, value: string) => void;
  onApproveAndRun: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onReset: () => void;

  eventsEndRef: RefObject<HTMLDivElement | null>;

  /** Used to format reset dates for the quota-exceeded view. */
  formatResetDate: (iso: string) => string;
}

export function OperatorTranscript(props: OperatorTranscriptProps) {
  const { phase } = props;

  switch (phase) {
    case "idle":
      return <IdleSessionHeader {...props} />;
    case "planning":
      return <PlanningView />;
    case "awaiting_approval":
      return <AwaitingApprovalView {...props} />;
    case "executing":
      return <ExecutingView {...props} />;
    case "completed":
      return <CompletedView {...props} />;
    case "failed":
      return <FailedView {...props} />;
    case "cancelled":
      return <CancelledView onReset={props.onReset} />;
    case "quota_exceeded":
      return <QuotaExceededView {...props} />;
    default:
      return <IdleSessionHeader {...props} />;
  }
}

function IdleSessionHeader({
  activeSessionId,
  runId,
  sessionHistoryRefreshKey,
}: OperatorTranscriptProps) {
  // Idle phase shows only the per-session run history above the composer.
  // The composer itself is rendered separately by the orchestrator so the
  // panel can keep input and scrollback in different layout slots.
  if (!activeSessionId) {
    return <div className="flex-1" />;
  }
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-col gap-1 p-4 pb-0">
        <p className="text-overline text-muted-foreground/70">This session</p>
        <Card size="sm" className="overflow-hidden p-0">
          <OperatorSessionHistory
            sessionId={activeSessionId}
            activeRunId={runId}
            refreshKey={sessionHistoryRefreshKey}
          />
        </Card>
      </div>
      <div className="flex-1" />
    </div>
  );
}

function PlanningView() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
      <Spinner size={24} />
      <p className="text-sm text-muted-foreground">Generating plan…</p>
    </div>
  );
}

function AwaitingApprovalView({
  prompt,
  steps,
  summary,
  liveTail,
  selectedModel,
  isExecPending,
  cancelling,
  runId,
  hideInlineActions,
  onApproveAndRun,
  onCancel,
  onStepDescriptionChange,
}: OperatorTranscriptProps) {
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
      {summary && <p className="text-sm text-muted-foreground">{summary}</p>}

      {liveTail.length > 0 && (
        <Card
          size="sm"
          className="bg-muted/30"
          aria-label="Live operator events"
        >
          <ul className="flex flex-col gap-0.5 px-4">
            {liveTail.map((evt, i) => (
              <li
                key={`tail-${evt.timestamp}-${evt.type}-${evt.step_index ?? "x"}-${i}`}
                className="flex items-start gap-2 text-[11px] text-muted-foreground"
              >
                <span className="shrink-0 tabular-nums">
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </span>
                <span className="truncate">{formatEventDetail(evt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Separator />

      <ScrollArea className="-mx-4 flex-1 px-4">
        <ol className="flex flex-col gap-2" aria-label="Plan steps">
          {steps.map((step) => (
            <li key={step.index}>
              <Card size="sm" className="bg-muted/30">
                <div className="flex items-start gap-2 px-4">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                    {step.index + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <input
                      type="text"
                      value={step.description}
                      onChange={(e) =>
                        onStepDescriptionChange(step.index, e.target.value)
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
                </div>
              </Card>
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
              estimateOperatorRunCost(prompt.length, steps.length, selectedModel)
            )}
          </span>{" "}
          ({selectedModel})
        </p>
        {!hideInlineActions && (
          <div className="flex flex-wrap items-center gap-2">
            {runId && (
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`/app/workspace_operator/live/${runId}`} />}
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
                Open full view
              </Button>
            )}
            <Button
              onClick={onApproveAndRun}
              disabled={isExecPending || steps.length === 0}
            >
              Approve &amp; Run
            </Button>
            <Button variant="outline" onClick={onCancel} disabled={cancelling}>
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ExecutingView({
  steps,
  runId,
  isActivePhase,
  cancelling,
  hideInlineActions,
  onCancel,
  eventsEndRef,
}: OperatorTranscriptProps) {
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
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

      <div className="-mx-4 min-h-0 flex-1">
        <OperatorActivityPanel runId={runId} runIsActive={isActivePhase} />
      </div>
      <div ref={eventsEndRef} />

      {!hideInlineActions && (
        <div className="flex flex-wrap items-center gap-2 self-start">
          {runId && (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/app/workspace_operator/live/${runId}`} />}
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
              Open full view
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={cancelling}
          >
            {cancelling ? "Cancelling…" : "Cancel run"}
          </Button>
        </div>
      )}
    </div>
  );
}

function CompletedView({ result, branchId, onReset }: OperatorTranscriptProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <CheckCircle2 className="h-10 w-10 text-success" aria-hidden="true" />
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
      <div className="flex flex-wrap items-center justify-center gap-2">
        {branchId && (
          <Button render={<Link href={`/app/branches/${branchId}`} />}>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
            Review Branch
          </Button>
        )}
        <Button variant="outline" onClick={onReset}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Run Again
        </Button>
      </div>
    </div>
  );
}

function FailedView({ error, runId, retrying, onRetry, onReset }: OperatorTranscriptProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <XCircle className="h-10 w-10 text-destructive" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">Operator run failed</p>
        {error && <p className="text-xs text-destructive/80">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {runId && (
          <Button onClick={onRetry} disabled={retrying}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        )}
        <Button variant="outline" onClick={onReset}>
          Start over
        </Button>
      </div>
    </div>
  );
}

function CancelledView({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <XCircle className="h-10 w-10 text-warning" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">Run cancelled</p>
      <Button variant="outline" onClick={onReset}>
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        Start over
      </Button>
    </div>
  );
}

function QuotaExceededView({
  quotaExceeded,
  formatResetDate,
  onReset,
}: OperatorTranscriptProps) {
  const q = quotaExceeded;
  if (!q) return null;
  const tierLabel =
    q.tier === "business" ? "Business" : q.tier === "pro" ? "Pro" : "Free";
  const canUpgrade = q.tier !== "business";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <BadgeAlert className="h-10 w-10 text-warning" aria-hidden="true" />
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
      <div className="flex flex-wrap items-center justify-center gap-2">
        {canUpgrade && (
          <Button render={<Link href="/app/settings#settings-billing" />}>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
            Upgrade plan
          </Button>
        )}
        <Button variant="outline" onClick={onReset}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Close
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live event log formatter (mirrors the original panel's formatEventDetail).
// ---------------------------------------------------------------------------

export function formatEventDetail(evt: OperatorProgressEvent): string {
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
