"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { OperatorProgressEvent } from "@/app/app/workspace_operator/types";

/**
 * Subscribe to realtime progress events for a Workspace Operator run.
 *
 * Listens on the `operator_run:${runId}` broadcast channel and
 * accumulates every `progress` event into a chronological array.
 * Returns an empty array (and skips subscribing) when `runId` is null.
 *
 * When `runId` changes the event list is reset and a fresh channel is
 * opened. The previous channel is removed on cleanup.
 */
export function useOperatorProgress(
  runId: string | null
): OperatorProgressEvent[] {
  const [events, setEvents] = useState<OperatorProgressEvent[]>([]);
  const runIdRef = useRef(runId);
  runIdRef.current = runId;

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      return;
    }

    const supabase = createClient();
    const channel = supabase.channel(`operator_run:${runId}`);

    channel.on("broadcast", { event: "progress" }, ({ payload }) => {
      // Guard against stale callbacks after a rapid runId switch.
      if (runIdRef.current !== runId) return;
      setEvents((prev) => [...prev, payload as OperatorProgressEvent]);
    });

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [runId]);

  return events;
}
