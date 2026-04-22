"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StreamedEvent = {
  sequence: number;
  event_type: string;
  payload: unknown;
};

export type StreamStatus = "connecting" | "open" | "closed" | "error";

export interface UseOperatorRunStreamResult {
  status: StreamStatus;
  events: StreamedEvent[];
  /** Concatenated text_delta payloads in arrival order. */
  streamedText: string;
  /** True once a terminal event (completed/failed/cancelled) has arrived. */
  isTerminal: boolean;
  /** Event type of the terminal event, if any. */
  terminalKind: string | null;
  /** Force close the EventSource. */
  close: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * All event types the server emits on the operator run SSE stream. Each is
 * registered as an explicit `addEventListener` target because EventSource
 * only dispatches `onmessage` for events WITHOUT an `event:` field, and our
 * server writes `event: <event_type>` per message.
 */
const KNOWN_EVENT_TYPES: readonly string[] = [
  "run_start",
  "run_end",
  "plan_ready",
  "plan_approved",
  "step_start",
  "step_complete",
  "tool_call_start",
  "tool_call_end",
  "tool_call_error",
  "tool_call_approval_requested",
  "tool_call_approval_granted",
  "tool_call_approval_rejected",
  "tool_call_preview_diff",
  "llm_call_start",
  "llm_call_end",
  "usage_update",
  "note_drafted",
  "steer_message_received",
  "guardrail_tripped",
  "subagent_start",
  "subagent_end",
  "text_delta",
  "completed",
  "failed",
  "cancelled",
  "done",
];

const TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
  "done",
]);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const CLOSED_RESULT: UseOperatorRunStreamResult = {
  status: "closed",
  events: [],
  streamedText: "",
  isTerminal: true,
  terminalKind: null,
  close: () => {},
};

/**
 * Subscribe to the operator run SSE stream at
 * `/api/operator/runs/${runId}/stream`. Accumulates every event (by
 * sequence, de-duplicated) and concatenates `text_delta` payloads into a
 * single `streamedText` string in arrival order.
 *
 * When `runId` is null we return an inert, already-terminal result so
 * consumers can safely mount the hook before they know the run id.
 */
export function useOperatorRunStream(
  runId: string | null,
): UseOperatorRunStreamResult {
  const [status, setStatus] = useState<StreamStatus>(
    runId ? "connecting" : "closed",
  );
  const [events, setEvents] = useState<StreamedEvent[]>([]);
  const [streamedText, setStreamedText] = useState<string>("");
  const [terminalKind, setTerminalKind] = useState<string | null>(null);

  // Hold the EventSource in a ref so unrelated re-renders don't re-open it.
  const esRef = useRef<EventSource | null>(null);
  // Track last-seen sequence to collapse duplicate deliveries (history +
  // realtime can race). Sequences are monotonically non-decreasing per run,
  // but a Set gives us exact de-dup in the face of any ordering oddity.
  const seenSequencesRef = useRef<Set<number>>(new Set());

  const close = useCallback(() => {
    const es = esRef.current;
    if (es) {
      try {
        es.close();
      } catch {
        // noop
      }
      esRef.current = null;
    }
    setStatus((prev) => (prev === "closed" ? prev : "closed"));
  }, []);

  useEffect(() => {
    if (!runId) {
      // Reset state for the no-runId branch.
      seenSequencesRef.current = new Set();
      setEvents([]);
      setStreamedText("");
      setTerminalKind(null);
      setStatus("closed");
      return;
    }

    // Reset for a fresh subscription.
    seenSequencesRef.current = new Set();
    setEvents([]);
    setStreamedText("");
    setTerminalKind(null);
    setStatus("connecting");

    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      // SSR / non-browser safety: nothing to subscribe to.
      return;
    }

    const es = new EventSource(`/api/operator/runs/${runId}/stream`);
    esRef.current = es;

    es.onopen = () => {
      setStatus("open");
    };

    const handleEvent = (rawData: string, eventType: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawData);
      } catch {
        // Server sends `data: {}` for the `done` sentinel — treat anything
        // unparsable as a best-effort terminal signal when the event name
        // itself is terminal.
        if (TERMINAL_EVENT_TYPES.has(eventType)) {
          setTerminalKind(eventType);
          close();
        }
        return;
      }

      // The server wraps every row as
      //   { sequence, event_type, payload }
      // but the `done` sentinel carries `{}`. Handle both shapes.
      const record = (parsed ?? {}) as Record<string, unknown>;
      const sequence =
        typeof record.sequence === "number" ? record.sequence : null;
      const emittedType =
        typeof record.event_type === "string"
          ? record.event_type
          : eventType;
      const payload = "payload" in record ? record.payload : undefined;

      if (sequence !== null) {
        if (seenSequencesRef.current.has(sequence)) {
          // Already handled this row — skip.
          return;
        }
        seenSequencesRef.current.add(sequence);

        const entry: StreamedEvent = {
          sequence,
          event_type: emittedType,
          payload,
        };
        setEvents((prev) => [...prev, entry]);

        if (emittedType === "text_delta") {
          const chunk = extractText(payload);
          if (chunk.length > 0) {
            setStreamedText((prev) => prev + chunk);
          }
        }
      }

      if (TERMINAL_EVENT_TYPES.has(emittedType)) {
        setTerminalKind((prev) => prev ?? emittedType);
        close();
      }
    };

    // Register a handler per known event type. EventSource only routes
    // named events via addEventListener.
    const listeners: Array<{ type: string; fn: (e: MessageEvent) => void }> =
      [];
    for (const eventType of KNOWN_EVENT_TYPES) {
      const fn = (e: MessageEvent) => handleEvent(e.data, eventType);
      es.addEventListener(eventType, fn);
      listeners.push({ type: eventType, fn });
    }

    // Fallback for any unnamed `data:` frames (shouldn't happen, but keeps
    // us resilient to server changes).
    es.onmessage = (e) => handleEvent(e.data, "message");

    es.onerror = () => {
      // EventSource tries to auto-reconnect on its own; we prefer explicit
      // control so consumers can decide whether to re-subscribe. Only
      // transition to "error" if we haven't already reached a terminal
      // close (a clean terminal will have fired close() already).
      setStatus((prev) => (prev === "closed" ? prev : "error"));
      try {
        es.close();
      } catch {
        // noop
      }
      if (esRef.current === es) {
        esRef.current = null;
      }
    };

    return () => {
      for (const { type, fn } of listeners) {
        es.removeEventListener(type, fn);
      }
      try {
        es.close();
      } catch {
        // noop
      }
      if (esRef.current === es) {
        esRef.current = null;
      }
    };
  }, [runId, close]);

  if (!runId) {
    return CLOSED_RESULT;
  }

  return {
    status,
    events,
    streamedText,
    isTerminal: terminalKind !== null,
    terminalKind,
    close,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(payload: unknown): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const rec = payload as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text;
  }
  return "";
}
