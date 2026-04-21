"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type ToolCallStatus =
  | "running"
  | "success"
  | "error"
  | "awaiting_approval";

export interface ToolCallCardProps {
  toolCallId: string;
  toolName: string;
  status: ToolCallStatus;
  args: Record<string, unknown> | null;
  result: Record<string, unknown> | string | null;
  elapsedMs: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  errorMessage?: string | null;
  initiallyExpanded?: boolean;
}

// ---------------------------------------------------------------------------
// Status colours — kept in one place so the header icon, label, and border
// accent can't drift out of sync.
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<
  ToolCallStatus,
  { icon: string; label: string; accent: string; text: string }
> = {
  running: {
    icon: "text-blue-500",
    label: "Running",
    accent: "border-l-blue-500",
    text: "text-blue-600 dark:text-blue-400",
  },
  success: {
    icon: "text-green-600 dark:text-green-400",
    label: "Success",
    accent: "border-l-green-500",
    text: "text-green-700 dark:text-green-400",
  },
  error: {
    icon: "text-destructive",
    label: "Error",
    accent: "border-l-destructive",
    text: "text-destructive",
  },
  awaiting_approval: {
    icon: "text-amber-500",
    label: "Awaiting approval",
    accent: "border-l-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
};

function StatusIcon({ status }: { status: ToolCallStatus }) {
  const s = STATUS_STYLES[status];
  switch (status) {
    case "running":
      return (
        <Loader2
          className={cn("h-3.5 w-3.5 animate-spin shrink-0", s.icon)}
          aria-label={s.label}
        />
      );
    case "success":
      return (
        <Check
          className={cn("h-3.5 w-3.5 shrink-0", s.icon)}
          aria-label={s.label}
        />
      );
    case "error":
      return (
        <XCircle
          className={cn("h-3.5 w-3.5 shrink-0", s.icon)}
          aria-label={s.label}
        />
      );
    case "awaiting_approval":
      return (
        <Clock
          className={cn("h-3.5 w-3.5 shrink-0", s.icon)}
          aria-label={s.label}
        />
      );
  }
}

function formatElapsed(ms: number | null): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem.toString().padStart(2, "0")}s`;
}

/**
 * Safe JSON stringify — never throws on circular refs or BigInt; falls
 * back to String() so the UI still shows *something* rather than crashing.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function JsonBlock({ value }: { value: unknown }) {
  const text =
    typeof value === "string" ? value : safeStringify(value);
  return (
    <div className="text-xs font-mono bg-muted rounded p-2 overflow-x-auto max-h-48">
      <pre className="whitespace-pre-wrap break-words">
        <code>{text}</code>
      </pre>
    </div>
  );
}

/**
 * Collapsible card rendering a single tool invocation. Header row stays
 * visible when collapsed so callers can pack many cards into a narrow
 * panel without losing at-a-glance status.
 */
export function ToolCallCard({
  toolCallId,
  toolName,
  status,
  args,
  result,
  elapsedMs,
  inputTokens,
  outputTokens,
  errorMessage,
  initiallyExpanded = false,
}: ToolCallCardProps) {
  // Errors auto-expand so the user doesn't have to click to see what went
  // wrong; other statuses respect `initiallyExpanded`.
  const [expanded, setExpanded] = useState(
    initiallyExpanded || status === "error",
  );
  const s = STATUS_STYLES[status];
  const elapsedText = formatElapsed(elapsedMs);

  const tokenPieces: string[] = [];
  if (typeof inputTokens === "number") tokenPieces.push(`${inputTokens}↑`);
  if (typeof outputTokens === "number")
    tokenPieces.push(`${outputTokens}↓`);
  const tokenText = tokenPieces.join(" ");

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-card text-card-foreground",
        "border-l-2",
        s.accent,
      )}
      data-tool-call-id={toolCallId}
      data-status={status}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={`tool-call-body-${toolCallId}`}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
          "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "hover:bg-accent/40",
        )}
      >
        {expanded ? (
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        ) : (
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <StatusIcon status={status} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          {toolName}
        </span>
        {tokenText && (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/80">
            {tokenText}
          </span>
        )}
        <span
          className={cn(
            "shrink-0 font-mono text-[10px] tabular-nums",
            status === "error"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {elapsedText || (status === "running" ? "…" : "")}
        </span>
      </button>

      {expanded && (
        <div
          id={`tool-call-body-${toolCallId}`}
          className="flex flex-col gap-2 border-t border-border/60 px-2.5 py-2"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Arguments
            </span>
            {args ? (
              <JsonBlock value={args} />
            ) : (
              <span className="text-xs italic text-muted-foreground/70">
                (none)
              </span>
            )}
          </div>

          {errorMessage ? (
            <div className="flex flex-col gap-1">
              <span
                className={cn(
                  "text-[10px] font-medium uppercase tracking-wide",
                  s.text,
                )}
              >
                Error
              </span>
              <div className="rounded p-2 text-xs font-mono bg-destructive/10 text-destructive whitespace-pre-wrap break-words">
                {errorMessage}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Result
              </span>
              {result != null ? (
                <JsonBlock value={result} />
              ) : (
                <span className="text-xs italic text-muted-foreground/70">
                  {status === "running" || status === "awaiting_approval"
                    ? "(pending)"
                    : "(no result)"}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
