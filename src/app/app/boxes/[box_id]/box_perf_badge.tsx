"use client";

import { useEffect, useState } from "react";

/**
 * [perf] TEMP on-screen timing badge — remove once box-open latency is fixed.
 *
 * Shows the server render time (measured in the box page) plus a client-side
 * number: the gap between when the server finished rendering and when this
 * component mounts in the browser. That gap ≈ network transfer + JS
 * download/parse/hydrate — i.e. the non-server half of the box-open time.
 * (Server and browser clocks can differ slightly, but for a multi-second gap
 * it's a clear signal of where the time goes.)
 */
export function BoxPerfBadge({
  serverMs,
  serverEndEpoch,
}: {
  serverMs: number;
  serverEndEpoch: number;
}) {
  const [clientMs, setClientMs] = useState<number | null>(null);

  useEffect(() => {
    setClientMs(Math.max(0, Date.now() - serverEndEpoch));
  }, [serverEndEpoch]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        left: 8,
        zIndex: 9999,
        background: "rgba(0,0,0,0.88)",
        color: "#22ff88",
        font: "12px ui-monospace, monospace",
        padding: "5px 10px",
        borderRadius: 6,
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      ⏱ server {serverMs}ms
      {clientMs !== null
        ? ` · client+net ${clientMs}ms · total ${serverMs + clientMs}ms`
        : " · measuring client…"}
    </div>
  );
}
