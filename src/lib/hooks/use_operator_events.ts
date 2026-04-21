"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

/**
 * Rich tool-call / lifecycle event — matches the payload emitted by the
 * Python agent's StreamingOperatorHooks via
 * `POST /api/agent/operator/tool_call_event`, then broadcast on the
 * `operator_run:${runId}` channel as `event: "event"`.
 */
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

/**
 * Subscribe to the V3 agent's rich event stream. Accumulates every
 * `event` broadcast into a chronological array, ordered by `sequence`.
 *
 * Returns an empty array (and skips subscribing) when `runId` is null.
 * Events arrive out of order occasionally — we insert by sequence so
 * the displayed stream is always in agent-emission order.
 */
export function useOperatorEvents(
  runId: string | null
): ToolCallEvent[] {
  const [events, setEvents] = useState<ToolCallEvent[]>([]);
  const runIdRef = useRef(runId);
  runIdRef.current = runId;

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      return;
    }
    const supabase = createClient();
    const channel = supabase.channel(`operator_run:${runId}`);

    channel.on("broadcast", { event: "event" }, ({ payload }) => {
      if (runIdRef.current !== runId) return;
      const evt = payload as ToolCallEvent;
      setEvents((prev) => {
        // Insert in ascending sequence order. Duplicates collapse on id.
        if (prev.some((e) => e.sequence === evt.sequence)) return prev;
        const next = [...prev, evt];
        next.sort((a, b) => a.sequence - b.sequence);
        return next;
      });
    });

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [runId]);

  return events;
}

/**
 * Derived running-total usage from a ToolCallEvent stream. Picks the
 * most-recent `usage_update` event's totals; returns zeros when no
 * usage has been reported yet.
 */
export function useUsageFromEvents(events: ToolCallEvent[]): {
  inputTokens: number;
  outputTokens: number;
} {
  const usage = { inputTokens: 0, outputTokens: 0 };
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.event_type === "usage_update") {
      const p = e.payload as Record<string, unknown>;
      usage.inputTokens = (p.input_tokens_total as number) ?? 0;
      usage.outputTokens = (p.output_tokens_total as number) ?? 0;
      break;
    }
  }
  return usage;
}
