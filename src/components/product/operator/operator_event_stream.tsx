"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, FileText, Search, Sparkles, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
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
      return <Sparkles className="h-3.5 w-3.5 text-brand" aria-hidden="true" />;
    case "step_start":
    case "step_complete":
      return <Search className="h-3.5 w-3.5 text-info" aria-hidden="true" />;
    case "tool_call":
      return <Wrench className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />;
    case "note_drafted":
      return <FileText className="h-3.5 w-3.5 text-success" aria-hidden="true" />;
    case "completed":
      return <Sparkles className="h-3.5 w-3.5 text-success" aria-hidden="true" />;
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
          "font-mono text-xs rounded-lg border border-border bg-muted/30 p-3",
          contain && "flex-1 overflow-y-auto",
        )}
        role="log"
        aria-label="Operator event stream"
        aria-live="polite"
      >
        {events.length === 0 ? (
          <div className="flex h-full min-h-[120px] items-center justify-center text-muted-foreground">
            <span className="text-xs">
              Waiting for events…
            </span>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {events.map((evt, i) => (
              <li
                // Event stream is strictly append-only; timestamp + type +
                // step_index is stable and unique in practice, with `i` as
                // a last-resort tiebreaker for duplicate sub-ms events.
                key={`${evt.timestamp}-${evt.type}-${evt.step_index ?? "x"}-${i}`}
                className={cn(
                  "flex items-start gap-2 rounded-md px-1.5 py-1",
                  evt.type === "failed" &&
                    "bg-destructive/5 text-destructive",
                  evt.type === "completed" &&
                    "bg-success/5 text-success",
                )}
              >
                <span className="shrink-0 select-none text-[11px] tabular-nums text-muted-foreground">
                  {formatTime(evt.timestamp)}
                </span>
                <span className="mt-0.5 shrink-0">{eventIcon(evt.type)}</span>
                <span className="min-w-0 flex-1 break-words text-foreground">
                  {eventLabel(evt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} aria-hidden="true" />
      </div>

      {!pinnedToBottom && events.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="pill"
          onClick={jumpToBottom}
          className="absolute bottom-3 right-3 bg-background/95"
          aria-label="Jump to latest event"
        >
          <ArrowDown className="h-3 w-3" aria-hidden="true" />
          Latest
        </Button>
      )}
    </div>
  );
}
