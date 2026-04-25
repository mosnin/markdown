"use client";

import { useState } from "react";
import {
  ArrowRight,
  MousePointerClick,
  Type,
  ScanText,
  Camera,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BrowsingSessionStep } from "@/server/domain/types/web_tool";

interface WebSessionStepsProps {
  steps: BrowsingSessionStep[];
}

export function WebSessionSteps({ steps }: WebSessionStepsProps) {
  if (steps.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-card/50 px-4 py-6 text-center text-xs text-muted-foreground">
        No steps recorded yet.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-2 list-none">
      {steps.map((step) => (
        <li key={step.id}>
          <StepRow step={step} />
        </li>
      ))}
    </ol>
  );
}

function StepRow({ step }: { step: BrowsingSessionStep }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = actionIcon(step.action);
  const hasContent = Boolean(step.extracted_content);

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={!hasContent}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
          hasContent && "hover:bg-accent/40",
          !hasContent && "cursor-default"
        )}
      >
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium tabular-nums text-muted-foreground">
          {step.step_number}
        </span>
        <Icon
          className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">
            {labelForAction(step.action)}
            {step.selector && (
              <span className="ml-2 font-mono text-[10px] font-normal text-muted-foreground">
                {step.selector}
              </span>
            )}
          </p>
          {step.url && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{step.url}</span>
            </p>
          )}
        </div>
        {step.action_took_ms != null && (
          <span className="mt-0.5 shrink-0 tabular-nums text-[10px] text-muted-foreground/70">
            {step.action_took_ms}ms
          </span>
        )}
        {hasContent &&
          (expanded ? (
            <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ))}
      </button>
      {expanded && hasContent && (
        <div className="border-t border-border/60 bg-muted/30 px-4 py-3">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] text-foreground/80">
            {step.extracted_content}
          </pre>
        </div>
      )}
    </div>
  );
}

function actionIcon(action: BrowsingSessionStep["action"]) {
  switch (action) {
    case "navigate":
      return ArrowRight;
    case "click":
      return MousePointerClick;
    case "fill":
      return Type;
    case "extract":
      return ScanText;
    case "screenshot":
      return Camera;
  }
}

function labelForAction(action: BrowsingSessionStep["action"]): string {
  switch (action) {
    case "navigate":
      return "Navigate";
    case "click":
      return "Click";
    case "fill":
      return "Fill";
    case "extract":
      return "Extract content";
    case "screenshot":
      return "Screenshot";
  }
}
