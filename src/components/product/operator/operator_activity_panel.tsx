"use client";

/**
 * OperatorActivityPanel — the V3 rich-activity view for a running (or
 * recently-completed) Workspace Operator run.
 *
 * Composes four V3 components plus a live token counter header:
 *
 *   * EnhancedEventStream — collapsible tool-call cards + log lines,
 *     driven by the rich `event`-type broadcast from the Python
 *     StreamingOperatorHooks.
 *   * LiveTokenCounter — derived from the most recent usage_update.
 *   * ApprovalQueue — renders pending tool-call approvals inline
 *     while the run is paused for human review.
 *   * SteerInput — lets the user inject a message mid-run.
 *
 * All four components are self-contained; this aggregator just wires
 * a shared runId and some layout chrome around them so the operator
 * panel can mount one component and get the whole V3 surface.
 */

import { useMemo } from "react";
import { Activity } from "lucide-react";

import {
  useOperatorEvents,
  useUsageFromEvents,
  type ToolCallEvent,
} from "@/lib/hooks/use_operator_events";
import { EnhancedEventStream } from "@/components/product/enhanced_event_stream";
import { LiveTokenCounter } from "@/components/product/live_token_counter";
import { ApprovalQueue } from "@/components/product/approval_queue";
import { SteerInput } from "@/components/product/steer_input";
import { EmptyState } from "@/components/product/empty_state";

export interface OperatorActivityPanelProps {
  runId: string | null;
  /** When true, the steer + approval affordances are enabled. */
  runIsActive: boolean;
  /** Per-run caps, passed through to the token counter. */
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  /** Model id that served the run (displayed in the counter chip). */
  model?: string | null;
}

export function OperatorActivityPanel({
  runId,
  runIsActive,
  maxInputTokens,
  maxOutputTokens,
  model,
}: OperatorActivityPanelProps) {
  const events = useOperatorEvents(runId);
  const usage = useUsageFromEvents(events);

  // We want a stable ordering — useOperatorEvents already sorts by
  // sequence, so this is effectively identity. The useMemo keeps the
  // EnhancedEventStream from re-rendering if the event list reference
  // changes but contents didn't.
  const visibleEvents = useMemo<ToolCallEvent[]>(() => events, [events]);

  if (!runId) {
    return (
      <EmptyState
        icon={<Activity />}
        title="No active run"
        description="Start one from the operator panel."
        size="sm"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Header — token counter + run id */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="truncate font-mono text-[12px] text-muted-foreground">
          run {runId.slice(0, 8)}…
        </div>
        <LiveTokenCounter
          inputTokens={usage.inputTokens}
          outputTokens={usage.outputTokens}
          maxInputTokens={maxInputTokens ?? null}
          maxOutputTokens={maxOutputTokens ?? null}
          model={model ?? null}
        />
      </div>

      {/* Approval queue — only visible when there are pending approvals */}
      <ApprovalQueue runId={runId} />

      {/* Event stream — fills available space */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <EnhancedEventStream events={visibleEvents} autoScroll />
      </div>

      {/* Steer input — disabled when run is not active */}
      <div className="border-t border-border p-2">
        <SteerInput runId={runId} enabled={runIsActive} />
      </div>
    </div>
  );
}
