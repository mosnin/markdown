"use client";

import Link from "next/link";
import { Activity, ArrowUpRight, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/product/empty_state";
import { EnhancedEventStream } from "@/components/product/enhanced_event_stream";
import { useOperatorEvents } from "@/lib/hooks/use_operator_events";
import type {
  OperatorPlanStep,
  OperatorRunPhase,
} from "@/app/app/workspace_operator/types";

// ---------------------------------------------------------------------------
// Operator plan rail — the right-side "Plan & diff" rail used when the
// operator panel is mounted as a top-level page (`mode === "page"`).
//
// Mirrors `dashboard_plan_panel.tsx` so the operator route inherits the
// canonical app-shell layout: composer + transcript on the left, plan +
// live tool-call stream on the right. Hidden below `lg` — on mobile the
// transcript already absorbs the same information inline.
// ---------------------------------------------------------------------------

export interface OperatorPlanRailProps {
  runId: string | null;
  phase: OperatorRunPhase;
  prompt: string;
  steps: OperatorPlanStep[];
}

export function OperatorPlanRail({
  runId,
  phase,
  prompt,
  steps,
}: OperatorPlanRailProps) {
  const events = useOperatorEvents(runId);
  const hasEvents = events.length > 0;
  const phaseLabel = phaseToLabel(phase);

  return (
    <aside
      aria-label="Plan and diff"
      className="hidden w-[360px] shrink-0 flex-col border-l border-border bg-background lg:flex"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <p className="text-overline text-muted-foreground">Plan &amp; diff</p>
        {phaseLabel && <Badge variant="info">{phaseLabel}</Badge>}
      </div>

      {!runId ? (
        <div className="flex-1 overflow-hidden">
          <EmptyState
            icon={<Sparkles aria-hidden="true" />}
            title="Plans appear here when an agent is running."
            description="Send a prompt below to begin."
            size="default"
          />
        </div>
      ) : (
        <>
          <div className="px-4 pt-4">
            <Card size="sm" className="bg-muted/30">
              <div className="px-4">
                <p className="text-overline text-muted-foreground">Active run</p>
                <p className="mt-1.5 line-clamp-3 text-sm text-foreground">
                  {prompt || "Run dispatched. Awaiting first event…"}
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="info" className="shrink-0">
                    <Activity className="size-3" aria-hidden="true" />
                    Live
                  </Badge>
                  <Button
                    variant="link"
                    size="sm"
                    className="shrink-0"
                    render={<Link href={`/app/workspace_operator/${runId}`} />}
                  >
                    Open run
                    <ArrowUpRight aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          {steps.length > 0 && (
            <div className="px-4 pt-4">
              <p className="text-overline text-muted-foreground">Plan</p>
              <ol className="mt-2 flex flex-col gap-1.5">
                {steps.map((step) => (
                  <li
                    key={step.index}
                    className="flex items-start gap-2 text-xs text-foreground"
                  >
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                      {step.index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{step.description}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="mt-4 flex-1 overflow-hidden border-t border-border">
            {hasEvents ? (
              <EnhancedEventStream
                events={events}
                autoScroll
                contain
                className="h-full"
              />
            ) : (
              <EmptyState
                icon={<Activity aria-hidden="true" />}
                title="Waiting for the agent…"
                description="The first plan step or tool call will appear here."
                size="sm"
              />
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function phaseToLabel(phase: OperatorRunPhase): string | null {
  switch (phase) {
    case "planning":
      return "planning";
    case "awaiting_approval":
      return "awaiting approval";
    case "executing":
      return "executing";
    default:
      return null;
  }
}
