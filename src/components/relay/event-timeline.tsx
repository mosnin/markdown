"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ==========================================================================
   The live timeline.

   Server-rendered with recent history, then subscribed to the project's SSE
   stream so new events arrive without a refresh. A dashboard CAN hold a
   stream open — that is exactly the difference between it and an agent, and
   the reason the API offers both a stream and a poll.

   Marks encode salience, the same 0–5 scale the brief assembler sorts on: a
   decision or a blocker reads as signal, a file read as texture. The rail is
   the reference's history rail, unchanged.
   ========================================================================== */

export interface TimelineEvent {
  id: string;
  session_id: string;
  event_type: string;
  summary: string;
  importance: number;
  files: string[];
  occurred_at: string;
}

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Salience decides the mark, exactly as it decides what survives a brief. */
function markFor(importance: number): string {
  if (importance >= 5) return "border-agent bg-agent-wash";
  if (importance >= 3) return "border-strong bg-raised";
  return "border-hairline bg-inset";
}

export function EventTimeline({
  events: initial,
  projectSlug,
}: {
  events: TimelineEvent[];
  projectSlug: string;
}): ReactNode {
  const [events, setEvents] = useState<TimelineEvent[]>(initial);
  const [live, setLive] = useState(false);
  const seen = useRef(new Set(initial.map((e) => e.id)));

  useEffect(() => {
    // The stream is same-origin and cookie-authenticated, so no token handling
    // is needed here — the session that rendered the page is the one reading.
    const source = new EventSource(
      `/api/v1/relay/stream?project=${encodeURIComponent(projectSlug)}`,
    );

    source.addEventListener("open", () => setLive(true));

    source.addEventListener("session_event", (message) => {
      try {
        const payload = JSON.parse((message as MessageEvent).data) as
          | (TimelineEvent & { historical?: boolean })
          | null;
        if (!payload?.id || payload.historical) return;
        // The backfill overlaps what the server already rendered, so dedupe by
        // id rather than trusting the stream to start where the page stopped.
        if (seen.current.has(payload.id)) return;
        seen.current.add(payload.id);
        setEvents((current) => [payload, ...current].slice(0, 200));
      } catch {
        // A malformed frame costs one event, not the stream.
      }
    });

    source.addEventListener("error", () => setLive(false));

    return () => source.close();
  }, [projectSlug]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="t-label-caps text-ink-3">Timeline</h2>
        {live ? (
          <span className="t-label-caps inline-flex items-center gap-2 text-positive-text">
            <span className="size-[6px] rounded-full bg-positive-mark" />
            live
          </span>
        ) : null}
      </div>

      {events.length === 0 ? (
        <div className="rounded-12 border border-dashed border-hairline px-6 py-8 text-center">
          <p className="t-caption text-ink-3">Nothing logged yet.</p>
        </div>
      ) : (
        <div className="rounded-12 border border-hairline bg-raised p-6">
          <ol className="relative flex flex-col">
            <span className="absolute bottom-2 left-[7px] top-2 w-px bg-hairline" />
            {events.map((event) => (
              <li key={event.id} className="relative flex gap-5 pb-5 last:pb-0">
                <span className="relative mt-[3px] flex size-[15px] shrink-0 items-center justify-center">
                  <span
                    className={cn(
                      "size-[9px] rounded-2 border",
                      markFor(event.importance),
                    )}
                  />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-3">
                    <span className="t-mono-micro text-ink-4">
                      {event.event_type}
                    </span>
                    <span className="t-mono-micro ml-auto shrink-0 text-ink-4">
                      {relative(event.occurred_at)}
                    </span>
                  </div>
                  <span className="t-caption text-ink">{event.summary}</span>
                  {event.files.length > 0 ? (
                    <span className="t-mono-micro truncate text-ink-3">
                      {event.files.slice(0, 3).join(" · ")}
                      {event.files.length > 3
                        ? ` +${event.files.length - 3}`
                        : ""}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
