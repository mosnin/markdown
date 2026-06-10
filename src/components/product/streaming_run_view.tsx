"use client";

import { useEffect, useMemo } from "react";
import {
  AlertTriangle,
  Ban,
  Bot,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Sparkles,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  useOperatorRunStream,
  type StreamedEvent,
} from "@/hooks/use_operator_run_stream";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StreamingRunViewProps {
  runId: string;
  /** Shown before any text_delta arrives. */
  initialPrompt?: string;
  /** Callback when the stream reaches a terminal state. */
  onTerminal?: (kind: string) => void;
}

// ---------------------------------------------------------------------------
// Activity strip helpers
// ---------------------------------------------------------------------------

interface ActivityPill {
  key: string;
  Icon: LucideIcon;
  label: string;
  tone: "neutral" | "info" | "success" | "warn" | "error";
}

const TEXT_EVENT_TYPE = "text_delta";
const TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
  "done",
]);

function stringFromPayload(
  payload: unknown,
  keys: string[],
): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const rec = payload as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function pillForEvent(event: StreamedEvent): ActivityPill | null {
  const { event_type, payload, sequence } = event;
  switch (event_type) {
    case "tool_call_start": {
      const name =
        stringFromPayload(payload, ["tool_name", "name"]) ?? "tool";
      return {
        key: `${sequence}-${event_type}`,
        Icon: Wrench,
        label: name,
        tone: "info",
      };
    }
    case "tool_call_end":
      return {
        key: `${sequence}-${event_type}`,
        Icon: Wrench,
        label:
          stringFromPayload(payload, ["tool_name", "name"]) ?? "tool done",
        tone: "success",
      };
    case "tool_call_error":
      return {
        key: `${sequence}-${event_type}`,
        Icon: Wrench,
        label:
          stringFromPayload(payload, ["tool_name", "name"]) ?? "tool error",
        tone: "error",
      };
    case "subagent_start": {
      const label =
        stringFromPayload(payload, ["skill", "skill_id", "name"]) ?? "subagent";
      return {
        key: `${sequence}-${event_type}`,
        Icon: Workflow,
        label,
        tone: "info",
      };
    }
    case "subagent_end":
      return {
        key: `${sequence}-${event_type}`,
        Icon: Workflow,
        label:
          stringFromPayload(payload, ["skill", "skill_id", "name"]) ??
          "subagent done",
        tone: "success",
      };
    case "plan_ready":
      return {
        key: `${sequence}-${event_type}`,
        Icon: ClipboardList,
        label: "Plan",
        tone: "info",
      };
    case "plan_approved":
      return {
        key: `${sequence}-${event_type}`,
        Icon: ClipboardList,
        label: "Plan approved",
        tone: "success",
      };
    case "step_start":
      return {
        key: `${sequence}-${event_type}`,
        Icon: Sparkles,
        label:
          stringFromPayload(payload, ["summary", "detail"]) ?? "Step",
        tone: "neutral",
      };
    case "guardrail_tripped":
      return {
        key: `${sequence}-${event_type}`,
        Icon: AlertTriangle,
        label: "Guardrail",
        tone: "warn",
      };
    case "note_drafted":
      return {
        key: `${sequence}-${event_type}`,
        Icon: Sparkles,
        label: "Note drafted",
        tone: "success",
      };
    default:
      return null;
  }
}

function pillToneClasses(tone: ActivityPill["tone"]): string {
  switch (tone) {
    case "info":
      return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "success":
      return "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400";
    case "warn":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "error":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "neutral":
    default:
      return "border-border bg-background/80 text-foreground/80";
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function UserBubble({ prompt }: { prompt: string }) {
  return (
    <div className="flex w-full justify-end" aria-label="User message">
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary/10 px-4 py-2.5 text-sm text-foreground">
        <p className="whitespace-pre-wrap break-words">{prompt}</p>
      </div>
    </div>
  );
}

interface AssistantBubbleProps {
  streamedText: string;
  showCursor: boolean;
  isTerminal: boolean;
  terminalKind: string | null;
  isClosed: boolean;
}

function AssistantBubble({
  streamedText,
  showCursor,
  isTerminal,
  terminalKind,
  isClosed,
}: AssistantBubbleProps) {
  const hasText = streamedText.length > 0;
  const terminalLabel = terminalLabelFor(terminalKind);

  return (
    <div className="flex w-full gap-2" aria-label="Assistant message">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-500">
        <Bot className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="flex max-w-[80%] flex-1 flex-col rounded-2xl rounded-tl-sm bg-muted px-4 py-2.5 text-sm text-foreground">
        {hasText ? (
          <p className="whitespace-pre-wrap break-words">
            {streamedText}
            {showCursor ? (
              <span
                className="ml-0.5 inline-block animate-pulse align-baseline text-foreground/70"
                aria-hidden="true"
              >
                &#9608;
              </span>
            ) : null}
          </p>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            <span>Pog is thinking&hellip;</span>
          </div>
        )}

        {isTerminal && isClosed ? (
          <div
            className={cn(
              "mt-2 flex items-center gap-1 text-[11px]",
              terminalLabel.className,
            )}
          >
            <terminalLabel.Icon className="h-3 w-3" aria-hidden="true" />
            {terminalLabel.text}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface TerminalLabel {
  Icon: LucideIcon;
  text: string;
  className: string;
}

function terminalLabelFor(kind: string | null): TerminalLabel {
  switch (kind) {
    case "failed":
      return {
        Icon: AlertTriangle,
        text: "Failed",
        className: "text-destructive",
      };
    case "cancelled":
      return {
        Icon: Ban,
        text: "Cancelled",
        className: "text-amber-600 dark:text-amber-400",
      };
    case "completed":
    case "done":
    default:
      return {
        Icon: CheckCircle2,
        text: "Done",
        className: "text-muted-foreground",
      };
  }
}

function ActivityStrip({ events }: { events: StreamedEvent[] }) {
  const pills = useMemo(() => {
    const out: ActivityPill[] = [];
    // Walk from newest → oldest, skipping text_deltas and terminal sentinels,
    // stop once we have 5. Then reverse so the newest is rightmost.
    for (let i = events.length - 1; i >= 0 && out.length < 5; i--) {
      const evt = events[i];
      if (evt.event_type === TEXT_EVENT_TYPE) continue;
      if (TERMINAL_EVENT_TYPES.has(evt.event_type)) continue;
      const pill = pillForEvent(evt);
      if (pill) out.push(pill);
    }
    return out.reverse();
  }, [events]);

  if (pills.length === 0) return null;

  return (
    <ul
      className="flex flex-wrap items-center gap-1.5"
      aria-label="Recent activity"
    >
      {pills.map((pill) => (
        <li
          key={pill.key}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
            pillToneClasses(pill.tone),
          )}
        >
          <pill.Icon className="h-3 w-3" aria-hidden="true" />
          <span className="max-w-[14ch] truncate">{pill.label}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * StreamingRunView — live conversation view for an in-flight operator run.
 * Subscribes to the run's SSE stream via {@link useOperatorRunStream},
 * accumulates `text_delta` chunks into the assistant bubble, and surfaces
 * the last few non-text events as compact activity pills.
 */
export function StreamingRunView({
  runId,
  initialPrompt,
  onTerminal,
}: StreamingRunViewProps) {
  const {
    status,
    events,
    streamedText,
    isTerminal,
    terminalKind,
    close: _close,
  } = useOperatorRunStream(runId);
  // The hook manages its own cleanup; we accept the close handle for
  // future manual-cancel wiring but don't call it here.
  void _close;

  useEffect(() => {
    if (isTerminal && terminalKind && onTerminal) {
      onTerminal(terminalKind);
    }
    // We intentionally depend only on terminalKind so the callback fires
    // exactly once per terminal transition.
  }, [isTerminal, terminalKind, onTerminal]);

  const showCursor = status === "open" && !isTerminal;
  const isClosed = status === "closed";

  return (
    <div className="flex w-full flex-col gap-3">
      {initialPrompt ? <UserBubble prompt={initialPrompt} /> : null}

      {status === "error" ? (
        <div
          role="alert"
          className={cn(
            "flex items-center gap-1.5 rounded-md border border-amber-500/30",
            "bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400",
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Connection lost. Retrying&hellip;</span>
        </div>
      ) : null}

      <AssistantBubble
        streamedText={streamedText}
        showCursor={showCursor}
        isTerminal={isTerminal}
        terminalKind={terminalKind}
        isClosed={isClosed}
      />

      <ActivityStrip events={events} />
    </div>
  );
}
