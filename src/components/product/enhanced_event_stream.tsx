"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Ban,
  Bot,
  CheckCircle2,
  FileText,
  MessageSquare,
  Play,
  Search,
  ShieldAlert,
  Sparkles,
  StopCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ToolCallCard,
  type ToolCallStatus,
} from "@/components/product/tool_call_card";

// ---------------------------------------------------------------------------
// Event shape — mirrors the Realtime broadcast payload published by the
// Python agent via /api/agent/operator/tool_call_event.
// ---------------------------------------------------------------------------

export interface ToolCallEvent {
  sequence: number;
  run_id: string;
  event_type: string;
  tool_call_id: string | null;
  tool_name: string | null;
  step_index: number | null;
  payload: Record<string, unknown>;
  elapsed_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

export interface EnhancedEventStreamProps {
  events: ToolCallEvent[];
  autoScroll?: boolean;
  className?: string;
  /** When true (default) the viewport is constrained and scrolls internally. */
  contain?: boolean;
}

// ---------------------------------------------------------------------------
// Grouping — fold every tool_call_* event keyed by tool_call_id into a
// single aggregated record. Everything else becomes a "log" row.
// ---------------------------------------------------------------------------

export interface ToolCallGroup {
  kind: "tool_call";
  toolCallId: string;
  toolName: string;
  status: ToolCallStatus;
  args: Record<string, unknown> | null;
  result: Record<string, unknown> | string | null;
  elapsedMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorMessage: string | null;
  firstSequence: number;
  createdAt: string;
}

export interface LogGroup {
  kind: "log";
  event: ToolCallEvent;
}

export type EventGroup = ToolCallGroup | LogGroup;

const TOOL_CALL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "tool_call_start",
  "tool_call_end",
  "tool_call_error",
  "tool_call_approval_requested",
  "tool_call_approval_granted",
  "tool_call_approval_rejected",
  "tool_call_preview_diff",
]);

function coerceRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function coerceResult(
  v: unknown,
): Record<string, unknown> | string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  const rec = coerceRecord(v);
  return rec;
}

/**
 * Fold a chronological event list into render-ready groups. Exposed so
 * tests and callers can introspect the derivation without mounting.
 *
 * Ordering rule: tool_call groups are placed at the position of their
 * *first* event (typically tool_call_start) — subsequent updates merge
 * into the existing group rather than reordering the timeline.
 */
export function groupEventsIntoCards(
  events: ToolCallEvent[],
): EventGroup[] {
  const out: EventGroup[] = [];
  // Map of tool_call_id → index into `out` for O(1) merge-on-update.
  const indexById = new Map<string, number>();

  for (const evt of events) {
    const isToolCall =
      TOOL_CALL_EVENT_TYPES.has(evt.event_type) &&
      typeof evt.tool_call_id === "string" &&
      evt.tool_call_id.length > 0;

    if (!isToolCall) {
      // usage_update is a pure counter signal — the parent aggregates it
      // via its own tally, so we drop it from the visible stream.
      if (evt.event_type === "usage_update") continue;
      out.push({ kind: "log", event: evt });
      continue;
    }

    const id = evt.tool_call_id as string;
    const existingIdx = indexById.get(id);

    if (existingIdx == null) {
      // First sighting for this tool call — seed a group.
      const seeded = seedGroup(evt);
      indexById.set(id, out.length);
      out.push(seeded);
      continue;
    }

    // Merge into the existing group. The prior entry is guaranteed to be
    // a tool_call group since only seedGroup() registers the index.
    const prior = out[existingIdx];
    if (prior.kind !== "tool_call") continue;
    out[existingIdx] = mergeIntoGroup(prior, evt);
  }

  return out;
}

function seedGroup(evt: ToolCallEvent): ToolCallGroup {
  // A group can start from any tool_call_* event (events may arrive out
  // of logical order under retries) — pick a sensible initial status.
  let status: ToolCallStatus = "running";
  if (evt.event_type === "tool_call_error") status = "error";
  else if (evt.event_type === "tool_call_end") status = "success";
  else if (evt.event_type === "tool_call_approval_requested")
    status = "awaiting_approval";

  const payload = evt.payload ?? {};
  const args = coerceRecord(payload.args ?? payload.arguments);
  const result = coerceResult(payload.result ?? payload.output);
  const errorMessage =
    evt.event_type === "tool_call_error"
      ? stringFromPayload(payload, ["error", "message"])
      : null;

  return {
    kind: "tool_call",
    toolCallId: evt.tool_call_id as string,
    toolName: evt.tool_name ?? "unknown",
    status,
    args,
    result,
    elapsedMs: evt.elapsed_ms,
    inputTokens: evt.input_tokens,
    outputTokens: evt.output_tokens,
    errorMessage,
    firstSequence: evt.sequence,
    createdAt: evt.created_at,
  };
}

function mergeIntoGroup(
  prior: ToolCallGroup,
  evt: ToolCallEvent,
): ToolCallGroup {
  const payload = evt.payload ?? {};
  const next: ToolCallGroup = { ...prior };

  // Refresh tool name if we only had a placeholder before.
  if (evt.tool_name && next.toolName === "unknown") {
    next.toolName = evt.tool_name;
  }

  // Roll elapsed/tokens forward to whichever event reported them most
  // recently (end events typically carry the final totals).
  if (evt.elapsed_ms != null) next.elapsedMs = evt.elapsed_ms;
  if (evt.input_tokens != null) next.inputTokens = evt.input_tokens;
  if (evt.output_tokens != null) next.outputTokens = evt.output_tokens;

  // Merge args from start; prefer args from latest event if present.
  const newArgs = coerceRecord(payload.args ?? payload.arguments);
  if (newArgs) next.args = newArgs;

  const newResult = coerceResult(payload.result ?? payload.output);
  if (newResult != null) next.result = newResult;

  switch (evt.event_type) {
    case "tool_call_start":
      // Start after another start — reset to running.
      if (next.status !== "error" && next.status !== "success") {
        next.status = "running";
      }
      break;
    case "tool_call_approval_requested":
      if (next.status === "running") next.status = "awaiting_approval";
      break;
    case "tool_call_approval_granted":
      if (next.status === "awaiting_approval") next.status = "running";
      break;
    case "tool_call_approval_rejected":
      next.status = "error";
      next.errorMessage =
        next.errorMessage ?? "Approval rejected.";
      break;
    case "tool_call_end":
      // A prior error stays sticky — a late "end" shouldn't paper over it.
      if (next.status !== "error") next.status = "success";
      break;
    case "tool_call_error": {
      next.status = "error";
      const msg = stringFromPayload(payload, ["error", "message"]);
      if (msg) next.errorMessage = msg;
      else if (!next.errorMessage) next.errorMessage = "Tool call failed.";
      break;
    }
    case "tool_call_preview_diff":
      // Preview diffs don't change status; they're informational.
      break;
    default:
      break;
  }

  return next;
}

function stringFromPayload(
  payload: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Icon/label mapping for non-tool events. Mirrors operator_event_stream.tsx
// where choices overlap; new event types get plausible analogues.
// ---------------------------------------------------------------------------

interface EventVisual {
  Icon: LucideIcon;
  colorClass: string;
  label: (evt: ToolCallEvent) => string;
}

function iconForEventType(eventType: string): EventVisual {
  switch (eventType) {
    case "run_start":
      return {
        Icon: Play,
        colorClass: "text-blue-500",
        label: () => "Run started",
      };
    case "run_end":
      return {
        Icon: CheckCircle2,
        colorClass: "text-green-500",
        label: () => "Run ended",
      };
    case "plan_ready":
      return {
        Icon: Sparkles,
        colorClass: "text-amber-500",
        label: () => "Plan ready",
      };
    case "plan_approved":
      return {
        Icon: CheckCircle2,
        colorClass: "text-green-500",
        label: () => "Plan approved",
      };
    case "step_start":
      return {
        Icon: Search,
        colorClass: "text-blue-500",
        label: (e) =>
          `Starting step ${(e.step_index ?? 0) + 1}${detailSuffix(e)}`,
      };
    case "step_complete":
      return {
        Icon: Search,
        colorClass: "text-blue-500",
        label: (e) =>
          `Completed step ${(e.step_index ?? 0) + 1}${detailSuffix(e)}`,
      };
    case "llm_call_start":
      return {
        Icon: Bot,
        colorClass: "text-purple-500",
        label: () => "LLM call started",
      };
    case "llm_call_end":
      return {
        Icon: Bot,
        colorClass: "text-purple-500",
        label: () => "LLM call ended",
      };
    case "note_drafted":
      return {
        Icon: FileText,
        colorClass: "text-green-500",
        label: (e) => `Note drafted${detailSuffix(e)}`,
      };
    case "steer_message_received":
      return {
        Icon: MessageSquare,
        colorClass: "text-blue-500",
        label: (e) => `Steer message received${detailSuffix(e)}`,
      };
    case "guardrail_tripped":
      return {
        Icon: ShieldAlert,
        colorClass: "text-amber-600 dark:text-amber-400",
        label: (e) => `Guardrail tripped${detailSuffix(e)}`,
      };
    case "subagent_start":
      return {
        Icon: Bot,
        colorClass: "text-purple-500",
        label: (e) => `Subagent started${detailSuffix(e)}`,
      };
    case "subagent_end":
      return {
        Icon: Bot,
        colorClass: "text-purple-500",
        label: (e) => `Subagent ended${detailSuffix(e)}`,
      };
    case "completed":
      return {
        Icon: Sparkles,
        colorClass: "text-green-500",
        label: () => "Run completed",
      };
    case "failed":
      return {
        Icon: AlertTriangle,
        colorClass: "text-destructive",
        label: (e) => `Failed${detailSuffix(e)}`,
      };
    case "cancelled":
      return {
        Icon: Ban,
        colorClass: "text-amber-500",
        label: () => "Run cancelled",
      };
    default:
      return {
        Icon: StopCircle,
        colorClass: "text-muted-foreground",
        label: (e) =>
          stringFromPayload(e.payload ?? {}, ["detail", "message"]) ??
          e.event_type,
      };
  }
}

function detailSuffix(evt: ToolCallEvent): string {
  const detail = stringFromPayload(evt.payload ?? {}, [
    "detail",
    "message",
    "summary",
  ]);
  return detail ? `: ${detail}` : "";
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LogEntry({ event }: { event: ToolCallEvent }) {
  const { Icon, colorClass, label } = iconForEventType(event.event_type);
  return (
    <div className="flex items-center gap-2 text-sm py-1 px-2">
      <Icon
        className={cn("w-4 h-4 shrink-0", colorClass)}
        aria-hidden="true"
      />
      <span className="font-mono text-xs text-muted-foreground tabular-nums shrink-0">
        {formatTime(event.created_at)}
      </span>
      <span className="min-w-0 flex-1 break-words text-foreground/90">
        {label(event)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Rich event stream: renders tool-call groups as collapsible cards and
 * non-tool events as single-line log rows. Follows the same auto-scroll
 * "pinned to bottom vs. jump-to-latest pill" interaction as
 * operator_event_stream.tsx.
 */
export function EnhancedEventStream({
  events,
  autoScroll = true,
  className,
  contain = true,
}: EnhancedEventStreamProps) {
  const groups = useMemo(() => groupEventsIntoCards(events), [events]);

  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  useEffect(() => {
    if (!autoScroll || !pinnedToBottom) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length, pinnedToBottom, autoScroll]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distanceFromBottom =
      el.scrollHeight - (el.scrollTop + el.clientHeight);
    setPinnedToBottom(distanceFromBottom < 40);
  }

  function jumpToBottom() {
    setPinnedToBottom(true);
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  return (
    <div className={cn("relative flex flex-col", className)}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={cn(
          "rounded-lg border border-border/60 bg-muted/30 p-2",
          contain && "flex-1 overflow-y-auto",
        )}
        role="log"
        aria-label="Agent event stream"
        aria-live="polite"
      >
        {groups.length === 0 ? (
          <div className="flex h-full min-h-[120px] items-center justify-center text-muted-foreground/70">
            <span className="text-[11px] font-mono">
              Waiting for events…
            </span>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {groups.map((g, i) => (
              <li
                key={
                  g.kind === "tool_call"
                    ? `tc-${g.toolCallId}`
                    : `log-${g.event.sequence}-${i}`
                }
              >
                {g.kind === "tool_call" ? (
                  <ToolCallCard
                    toolCallId={g.toolCallId}
                    toolName={g.toolName}
                    status={g.status}
                    args={g.args}
                    result={g.result}
                    elapsedMs={g.elapsedMs}
                    inputTokens={g.inputTokens}
                    outputTokens={g.outputTokens}
                    errorMessage={g.errorMessage}
                  />
                ) : (
                  <LogEntry event={g.event} />
                )}
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} aria-hidden="true" />
      </div>

      {!pinnedToBottom && groups.length > 0 && (
        <button
          type="button"
          onClick={jumpToBottom}
          className={cn(
            "absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full",
            "border border-border bg-background/95 px-2.5 py-1 text-[11px] shadow-sm",
            "text-foreground hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label="Jump to latest event"
        >
          <ArrowDown className="h-3 w-3" aria-hidden="true" />
          Jump to latest
        </button>
      )}
    </div>
  );
}
