"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, FileText, Search, Sparkles, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import type { OperatorProgressEvent } from "@/app/app/workspace_operator/types";

interface OperatorEventStreamProps {
  events: OperatorProgressEvent[];
  className?: string;
  /** When true the viewport height is constrained and only scrolls internally. */
  contain?: boolean;
}

function eventIcon(type: OperatorProgressEvent["type"]) {
  switch (type) {
    case "plan_ready":
      return <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />;
    case "step_start":
    case "step_complete":
      return <Search className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />;
    case "tool_call":
      return <Wrench className="h-3.5 w-3.5 text-purple-500" aria-hidden="true" />;
    case "note_drafted":
      return <FileText className="h-3.5 w-3.5 text-green-500" aria-hidden="true" />;
    case "completed":
      return <Sparkles className="h-3.5 w-3.5 text-green-500" aria-hidden="true" />;
    case "failed":
      return <Sparkles className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />;
    default:
      return null;
  }
}

function eventLabel(evt: OperatorProgressEvent): string {
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

/**
 * Terminal-style streaming log of operator progress events. Auto-scrolls
 * to the latest event unless the user has scrolled up, in which case a
 * floating "jump to latest" button appears.
 */
export function OperatorEventStream({
  events,
  className,
  contain = true,
}: OperatorEventStreamProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  useEffect(() => {
    if (!pinnedToBottom) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length, pinnedToBottom]);

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
          "font-mono text-xs rounded-lg border border-border/60 bg-muted/30 p-3",
          contain && "flex-1 overflow-y-auto",
        )}
        role="log"
        aria-label="Operator event stream"
        aria-live="polite"
      >
        {events.length === 0 ? (
          <div className="flex h-full min-h-[120px] items-center justify-center text-muted-foreground/70">
            <span className="text-[11px]">
              Waiting for events…
            </span>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {events.map((evt, i) => (
              <li
                key={`${evt.type}-${i}`}
                className={cn(
                  "flex items-start gap-2 rounded px-1.5 py-1",
                  evt.type === "failed" &&
                    "bg-destructive/5 text-destructive",
                  evt.type === "completed" &&
                    "bg-green-500/5 text-green-700 dark:text-green-400",
                )}
              >
                <span className="shrink-0 select-none text-[10px] tabular-nums text-muted-foreground/70">
                  {formatTime(evt.timestamp)}
                </span>
                <span className="mt-0.5 shrink-0">{eventIcon(evt.type)}</span>
                <span className="min-w-0 flex-1 break-words text-foreground/90">
                  {eventLabel(evt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} aria-hidden="true" />
      </div>

      {!pinnedToBottom && events.length > 0 && (
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
          Latest
        </button>
      )}
    </div>
  );
}
