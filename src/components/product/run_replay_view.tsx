"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EnhancedEventStream } from "@/components/product/enhanced_event_stream";
import type { ToolCallEvent } from "@/lib/hooks/use_operator_events";
import type {
  OperatorRunStatus,
  WorkspaceOperatorRunRow,
} from "@/server/services/workspace_operator_runs_service";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RunReplayViewProps {
  runId: string;
  run: WorkspaceOperatorRunRow;
  initialEvents: ToolCallEvent[];
  initialNextCursor: number | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROMPT_PREVIEW_MAX = 80;
const PAGE_SIZE = 500;

/** Base step interval (ms) at 1x speed. */
const STEP_BASE_MS = 2000;

type ReplayMode = "all" | "stepped";
type PlaybackSpeed = 1 | 2 | 4 | 8;

const SPEEDS: readonly PlaybackSpeed[] = [1, 2, 4, 8] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function statusPillClasses(status: OperatorRunStatus): string {
  switch (status) {
    case "completed":
      return "bg-green-500/10 text-green-600 dark:text-green-400";
    case "failed":
      return "bg-destructive/10 text-destructive";
    case "cancelled":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "executing":
    case "planning":
    case "awaiting_approval":
    case "queued":
    default:
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * RunReplayView — client-side replay surface for a past operator run.
 *
 * Consumes a server-hydrated first page of durable `operator_run_events`
 * and paginates on demand via `GET /api/agent/operator/runs/[runId]/events`.
 * Supports two playback modes: "all" (show every event at once) and
 * "stepped" (reveal events on a timer so the operator run can be watched
 * back like a recording).
 */
export function RunReplayView({
  runId,
  run,
  initialEvents,
  initialNextCursor,
}: RunReplayViewProps) {
  // ─── Event pagination state ──────────────────────────────────────────────
  const [events, setEvents] = useState<ToolCallEvent[]>(initialEvents);
  const [cursor, setCursor] = useState<number | null>(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ─── Replay playback state ───────────────────────────────────────────────
  const [replayMode, setReplayMode] = useState<ReplayMode>("all");
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(4);
  const [playing, setPlaying] = useState<boolean>(false);

  // Keep the interval reference so we can clear it on mode / speed / unmount.
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Pagination ──────────────────────────────────────────────────────────
  const handleLoadMore = useCallback(async () => {
    if (cursor === null || loading) return;
    setLoading(true);
    setLoadError(null);
    try {
      const url = `/api/agent/operator/runs/${runId}/events?after_sequence=${cursor}&limit=${PAGE_SIZE}`;
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }
      const body = (await res.json()) as {
        data?: {
          events: ToolCallEvent[];
          next_cursor: number | null;
        };
        error?: unknown;
      };
      if (!body.data) {
        throw new Error("Malformed response");
      }
      const { events: newRows, next_cursor } = body.data;
      setEvents((prev) => [...prev, ...newRows]);
      setCursor(next_cursor);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load more events.",
      );
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, runId]);

  // ─── Stepped playback timer ──────────────────────────────────────────────
  useEffect(() => {
    // Clear any prior interval whenever the inputs change.
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (replayMode !== "stepped" || !playing) return;
    if (events.length === 0) return;

    const tickMs = STEP_BASE_MS / playbackSpeed;
    const id = setInterval(() => {
      setStepIndex((prev) => {
        if (prev >= events.length) {
          return prev;
        }
        return prev + 1;
      });
    }, tickMs);
    intervalRef.current = id;

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [replayMode, playing, playbackSpeed, events.length]);

  // Auto-pause once we reach the end of the revealed events in stepped mode.
  useEffect(() => {
    if (
      replayMode === "stepped" &&
      playing &&
      events.length > 0 &&
      stepIndex >= events.length
    ) {
      setPlaying(false);
    }
  }, [replayMode, playing, events.length, stepIndex]);

  // ─── Derived data ────────────────────────────────────────────────────────
  const visibleEvents = useMemo<ToolCallEvent[]>(() => {
    if (replayMode === "stepped") {
      return events.slice(0, stepIndex);
    }
    return events;
  }, [events, replayMode, stepIndex]);

  const promptPreview = truncate(run.prompt, PROMPT_PREVIEW_MAX);
  const pillClasses = statusPillClasses(run.status);

  // ─── Control handlers ────────────────────────────────────────────────────
  const toggleMode = useCallback(() => {
    setReplayMode((prev) => {
      if (prev === "all") {
        // Entering stepped mode — start paused at 0 so the user can hit play.
        setStepIndex(0);
        setPlaying(false);
        return "stepped";
      }
      // Returning to "all at once" — stop the timer.
      setPlaying(false);
      return "all";
    });
  }, []);

  const togglePlaying = useCallback(() => {
    setPlaying((prev) => {
      // If we're at the end, hitting play should rewind first so the
      // user actually sees something happen.
      if (!prev && stepIndex >= events.length) {
        setStepIndex(0);
      }
      return !prev;
    });
  }, [events.length, stepIndex]);

  const handleReset = useCallback(() => {
    setStepIndex(0);
    setPlaying(false);
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────
  const emptyStream = events.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Header bar ─────────────────────────────────────────────────── */}
      <header className="border-b border-border bg-background">
        <div className="flex flex-wrap items-center gap-3 px-6 py-3">
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-sm font-medium text-foreground"
              title={run.prompt}
            >
              {promptPreview}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-mono">run {runId.slice(0, 8)}…</span>
              <span aria-hidden="true">·</span>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
                  pillClasses,
                )}
              >
                {run.status}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">
                {run.input_tokens}/{run.output_tokens} tokens
              </span>
            </div>
          </div>

          {/* Replay controls */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {replayMode === "all" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={toggleMode}
                disabled={emptyStream}
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                Stepped replay
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={togglePlaying}
                  disabled={emptyStream}
                >
                  {playing ? (
                    <>
                      <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      Play
                    </>
                  )}
                </Button>
                <Button variant="ghost" size="sm" onClick={toggleMode}>
                  All at once
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  disabled={emptyStream || stepIndex === 0}
                  title="Restart playback from the first event"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  From start
                </Button>
                <div
                  className="flex items-center gap-0.5 rounded-full border border-border bg-background p-0.5"
                  role="group"
                  aria-label="Playback speed"
                >
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setPlaybackSpeed(s)}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors",
                        s === playbackSpeed
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      aria-pressed={s === playbackSpeed}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ─── Event stream ───────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {emptyStream ? (
          <div className="flex h-full items-center justify-center px-6 py-12 text-center">
            <p className="max-w-md text-sm text-muted-foreground">
              No durable events were captured for this run. (Pre-V3 runs do
              not have a replay stream.)
            </p>
          </div>
        ) : (
          <EnhancedEventStream events={visibleEvents} autoScroll={false} />
        )}
      </div>

      {/* ─── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-2 text-xs text-muted-foreground">
          <div>
            Showing{" "}
            <span className="font-mono text-foreground">
              {visibleEvents.length}
            </span>{" "}
            of{" "}
            <span className="font-mono text-foreground">{events.length}</span>{" "}
            event{events.length === 1 ? "" : "s"}
            {cursor !== null ? " · more available" : ""}
            {loadError ? (
              <span className="ml-2 text-destructive">· {loadError}</span>
            ) : null}
          </div>
          {cursor !== null ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadMore}
              disabled={loading}
            >
              {loading ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
