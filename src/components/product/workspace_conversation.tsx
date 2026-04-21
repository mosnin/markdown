"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Bot,
  FileText,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { EnhancedEventStream } from "@/components/product/enhanced_event_stream";
import { useOperatorEvents } from "@/lib/hooks/use_operator_events";
import { formatRelativeDateShort } from "@/lib/format_date";
import { cn } from "@/lib/utils";
import type {
  OperatorRunStatus,
  WorkspaceOperatorRunRow,
} from "@/server/services/workspace_operator_runs_service";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WorkspaceConversationProps {
  workspaceId: string;
  /** Past operator runs in the workspace, oldest first. Server-supplied. */
  initialRuns: WorkspaceOperatorRunRow[];
  /**
   * ISO timestamp captured on the server at render so relative dates
   * hydrate stable. Pass `new Date().toISOString()` from the page.
   */
  nowIso: string;
  /**
   * When set, the bottom of the transcript shows a live-streaming bubble
   * for this run id. The parent passes this after the composer kicks off
   * a new turn via `startConversationTurnAction`.
   */
  activeRunId: string | null;
  /** Display name of the user (for the user bubble avatar / aria label). */
  userDisplayName?: string | null;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES: ReadonlySet<OperatorRunStatus> = new Set([
  "queued",
  "planning",
  "awaiting_approval",
  "executing",
]);

function isActiveStatus(status: OperatorRunStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

function coerceSummary(result: unknown): string | null {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    const summary = r.summary;
    if (typeof summary === "string" && summary.length > 0) return summary;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface BubbleTimeProps {
  iso: string;
  nowIso: string;
}

function BubbleTime({ iso, nowIso }: BubbleTimeProps) {
  return (
    <p className="mt-1 text-[10px] text-muted-foreground">
      {formatRelativeDateShort(iso, nowIso)}
    </p>
  );
}

interface UserBubbleProps {
  prompt: string;
  createdAt: string;
  nowIso: string;
  userDisplayName?: string | null;
}

function UserBubble({
  prompt,
  createdAt,
  nowIso,
  userDisplayName,
}: UserBubbleProps) {
  const label = userDisplayName
    ? `Message from ${userDisplayName}`
    : "User message";
  return (
    <div className="flex w-full justify-end" aria-label={label}>
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary/10 px-4 py-2.5 text-sm text-foreground">
        <p className="whitespace-pre-wrap break-words">{prompt}</p>
        <BubbleTime iso={createdAt} nowIso={nowIso} />
      </div>
    </div>
  );
}

interface AssistantBubbleShellProps {
  children: React.ReactNode;
}

function AssistantBubbleShell({ children }: AssistantBubbleShellProps) {
  return (
    <div className="flex w-full gap-2" aria-label="Pog message">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-500">
        <Bot className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="flex max-w-[80%] flex-1 flex-col rounded-2xl rounded-tl-sm bg-muted px-4 py-2.5 text-sm text-foreground">
        {children}
      </div>
    </div>
  );
}

interface AssistantBubbleProps {
  run: WorkspaceOperatorRunRow;
  nowIso: string;
  showLiveStream: boolean;
}

function AssistantBubble({
  run,
  nowIso,
  showLiveStream,
}: AssistantBubbleProps) {
  return (
    <AssistantBubbleShell>
      <AssistantBubbleBody
        run={run}
        nowIso={nowIso}
        showLiveStream={showLiveStream}
      />
    </AssistantBubbleShell>
  );
}

function AssistantBubbleBody({
  run,
  nowIso,
  showLiveStream,
}: AssistantBubbleProps) {
  const summary = coerceSummary(run.result);
  const notesCount = run.notes_created?.length ?? 0;
  const toolCalls = run.tool_calls ?? 0;

  if (run.status === "completed") {
    return (
      <>
        <p className="text-xs text-muted-foreground">
          Drafted {notesCount} note{notesCount === 1 ? "" : "s"} · {toolCalls}{" "}
          tool call{toolCalls === 1 ? "" : "s"}
        </p>
        {summary ? (
          <p className="mt-1 whitespace-pre-wrap break-words">{summary}</p>
        ) : null}
        {notesCount > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {run.notes_created.map((noteId) => (
              <li key={noteId}>
                <Link
                  href={`/app/notes/${noteId}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border border-border",
                    "bg-background px-2 py-0.5 text-[11px] text-foreground",
                    "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <FileText className="h-3 w-3" aria-hidden="true" />
                  {noteId.slice(0, 8)}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-2">
          <Link
            href={`/app/workspace_operator/${run.id}/replay`}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            View timeline
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
        <BubbleTime iso={run.updated_at} nowIso={nowIso} />
      </>
    );
  }

  if (run.status === "failed") {
    const err = run.error ?? "The run failed.";
    return (
      <>
        <p className="flex items-start gap-1.5 text-destructive">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
          <span className="whitespace-pre-wrap break-words">{err}</span>
        </p>
        <div className="mt-2">
          <Link
            href={`/app/workspace_operator/${run.id}`}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            View error
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
        <BubbleTime iso={run.updated_at} nowIso={nowIso} />
      </>
    );
  }

  if (run.status === "cancelled") {
    return (
      <>
        <p className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
          <Ban className="h-3.5 w-3.5" aria-hidden="true" />
          Run cancelled
        </p>
        <BubbleTime iso={run.updated_at} nowIso={nowIso} />
      </>
    );
  }

  // Active statuses: queued | planning | awaiting_approval | executing
  return (
    <>
      <div className="flex items-center gap-2">
        <Badge variant="info" className="gap-1">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-info" />
          </span>
          Live
        </Badge>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner size={12} />
          Pog is thinking…
        </span>
      </div>
      {showLiveStream ? (
        <div className="mt-2 max-h-72 overflow-y-auto">
          <LiveEventStream runId={run.id} />
        </div>
      ) : (
        <div className="mt-2">
          <Link
            href={`/app/workspace_operator/live/${run.id}`}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Resume in full view
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      )}
      <BubbleTime iso={run.updated_at} nowIso={nowIso} />
    </>
  );
}

interface LiveEventStreamProps {
  runId: string;
}

/**
 * Thin wrapper around {@link useOperatorEvents} + {@link EnhancedEventStream}
 * so each live bubble subscribes to its own run channel in isolation. The
 * parent transcript handles scroll, so `autoScroll` is disabled here.
 */
function LiveEventStream({ runId }: LiveEventStreamProps) {
  const events = useOperatorEvents(runId);
  return <EnhancedEventStream events={events} autoScroll={false} />;
}

interface LiveNewTurnBubbleProps {
  runId: string;
}

function LiveNewTurnBubble({ runId }: LiveNewTurnBubbleProps) {
  return (
    <AssistantBubbleShell>
      <div className="flex items-center gap-2">
        <Spinner size={12} />
        <span className="text-xs text-muted-foreground">Pog is thinking…</span>
      </div>
      <div className="mt-2 max-h-72 overflow-y-auto">
        <LiveEventStream runId={runId} />
      </div>
      <div className="mt-2">
        <Link
          href={`/app/workspace_operator/live/${runId}`}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          Open full view
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
    </AssistantBubbleShell>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * WorkspaceConversation — chat-style transcript of past Operator runs plus
 * an optional live-streaming bubble for an in-flight run.
 *
 * The component is a flex column filling its parent's height with internal
 * scroll. Auto-scrolls to bottom on new content, but respects the user's
 * scroll position — scrolling up pins the transcript; scrolling back to the
 * bottom re-enables auto-follow.
 */
export function WorkspaceConversation({
  // `workspaceId` is part of the component contract for future use (filters,
  // scoped deep-links) but is not read in the v1 render path. Prefix with
  // void-ignore by referencing it in a no-op to satisfy the typechecker
  // without adding an underscore alias that would break the public prop name.
  workspaceId: _workspaceId,
  initialRuns,
  nowIso,
  activeRunId,
  userDisplayName,
}: WorkspaceConversationProps) {
  void _workspaceId;

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef<boolean>(true);
  const rafRef = useRef<number | null>(null);

  // Is `activeRunId` already represented in `initialRuns`? If so, we augment
  // the existing bubble with the event stream rather than appending a new one.
  const activeRunInInitial = useMemo(() => {
    if (!activeRunId) return false;
    return initialRuns.some((r) => r.id === activeRunId);
  }, [initialRuns, activeRunId]);

  const showExtraLiveBubble = activeRunId != null && !activeRunInInitial;

  // Auto-scroll anchor: debounced via rAF so smooth scrolling doesn't fight
  // user gestures. Only scrolls when the user is currently pinned to bottom.
  useEffect(() => {
    if (!pinnedToBottomRef.current) return;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      rafRef.current = null;
    });
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [initialRuns.length, activeRunId]);

  // Mount: jump (not smooth) to bottom so the latest exchange is visible
  // immediately without an animation.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedToBottomRef.current = true;
  }, []);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distanceFromBottom =
      el.scrollHeight - (el.scrollTop + el.clientHeight);
    pinnedToBottomRef.current = distanceFromBottom < 40;
  }

  const isEmpty = initialRuns.length === 0 && activeRunId == null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto"
        role="log"
        aria-label="Conversation with Pog"
        aria-live="polite"
      >
        {isEmpty ? (
          <div className="flex h-full w-full items-center justify-center px-6 py-12">
            <div className="m-auto flex max-w-md flex-col items-center gap-3 text-center text-muted-foreground">
              <Sparkles className="h-8 w-8" aria-hidden="true" />
              <p className="text-sm">
                Ask Pog about your workspace. Try “Summarize my recent notes,”
                “What did I write about X last week?”, or “Draft a brief on
                Y.”
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
            {initialRuns.map((run) => {
              const isLiveTarget =
                activeRunId === run.id && isActiveStatus(run.status);
              return (
                <div key={run.id} className="flex flex-col gap-3">
                  <UserBubble
                    prompt={run.prompt}
                    createdAt={run.created_at}
                    nowIso={nowIso}
                    userDisplayName={userDisplayName}
                  />
                  <AssistantBubble
                    run={run}
                    nowIso={nowIso}
                    showLiveStream={isLiveTarget}
                  />
                </div>
              );
            })}
            {showExtraLiveBubble ? (
              <LiveNewTurnBubble runId={activeRunId} />
            ) : null}
          </div>
        )}
        <div ref={endRef} aria-hidden="true" />
      </div>
    </div>
  );
}
