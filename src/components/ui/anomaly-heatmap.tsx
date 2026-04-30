"use client";
import React, { useMemo } from "react";
import { cn } from "@/lib/utils";

type AnomalyHeatmapProps = {
  rows?: number;
  cols?: number;
  cardTitle?: string;
  cardDescription?: string;
};

/**
 * Anomaly heatmap mockup card.
 *
 * Marketing decoration was previously a violet conic-gradient glow with
 * hover-driven scale + drop-shadows. The redesign strips ornament: this
 * is now a small, dignified product mockup card with a hairline border,
 * bg-card surface, and a monochrome heat grid where intensity is
 * expressed via foreground opacity.
 *
 * Original props (`rows`, `cols`, `cardTitle`, `cardDescription`) are
 * preserved so existing call sites continue to render.
 */
export const AnomalyHeatmap = ({
  rows = 6,
  cols = 10,
  cardTitle = "Anomaly heatmap",
  cardDescription = "Intensity of suspicious signals across time windows.",
}: AnomalyHeatmapProps) => {
  const cells = useMemo(() => rows * cols, [rows, cols]);
  // Deterministic intensities so SSR + client agree; same shape as before.
  const data = useMemo(
    () => Array.from({ length: cells }, (_, i) => (Math.sin(i * 1.3) + 1) / 2),
    [cells],
  );

  return (
    <div
      className={cn(
        "relative flex h-[20rem] w-[350px] max-w-[350px] flex-col gap-3",
        "rounded-lg border border-border bg-card p-5",
      )}
    >
      <header>
        <h3 className="text-sm font-semibold text-foreground">{cardTitle}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{cardDescription}</p>
      </header>

      <div
        className="mt-2 grid flex-1 gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {data.map((v, i) => (
          <div
            key={i}
            className="rounded-[3px] bg-foreground"
            // Opacity carries the intensity — monochrome, restrained.
            style={{ opacity: 0.06 + v * 0.34 }}
          />
        ))}
      </div>
    </div>
  );
};

export default AnomalyHeatmap;
