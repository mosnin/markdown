"use client";
import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type FeedItem = { id: string; title: string; message: string; time: string };

type NotificationFeedProps = {
  cardTitle?: string;
  cardDescription?: string;
  feed?: FeedItem[];
};

const defaultFeed: FeedItem[] = [
  { id: "1", title: "architecture.md", message: "Saved to Architecture · v12", time: "now" },
  { id: "2", title: "system_design.md", message: "Linked → api_contracts.md", time: "1m" },
  { id: "3", title: "caching_strategy.md", message: "Moved to Decisions box", time: "3m" },
  { id: "4", title: "Architecture", message: "Box guide updated · 6 notes", time: "5m" },
  { id: "5", title: "data_flow.md", message: "Tagged: architecture, diagrams", time: "7m" },
];

/**
 * Notification feed mockup card.
 *
 * The redesign strips the marketing ornament: no motion-driven glow, no
 * gradient fade, no neon dots. The component still rotates feed items so
 * any live usage stays functional, but the surface itself is now a small
 * dignified product card — hairline border, bg-card, neutral type.
 *
 * The original prop signature is preserved so callers don't break.
 */
export const NotificationCenterFeed = ({
  cardTitle = "Organized in real time",
  cardDescription = "Every note, link, and move tracked live.",
  feed = defaultFeed,
}: NotificationFeedProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [items, setItems] = useState(feed);
  // Compute the clock label after mount so the SSR HTML hydrates
  // identically on every client regardless of the server-vs-client
  // wall-clock skew.
  const [clockLabel, setClockLabel] = useState("");
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const refreshClock = () => {
      setClockLabel(
        new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      );
    };
    refreshClock();
    const clockInterval = setInterval(refreshClock, 60_000);
    return () => clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    if (isHovered) return;
    timerRef.current = setInterval(() => {
      setItems((prev) => {
        const [first, ...rest] = prev;
        return [...rest, first];
      });
    }, 1600);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isHovered]);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "relative flex max-w-[350px] flex-col gap-3",
        "rounded-lg border border-border bg-card p-5",
      )}
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{cardTitle}</h3>
        <span
          aria-hidden
          className="text-[11px] tabular-nums text-muted-foreground"
        >
          {clockLabel}
        </span>
      </header>
      <p className="text-xs text-muted-foreground">{cardDescription}</p>

      <ul className="mt-1 divide-y divide-border overflow-hidden rounded-md border border-border">
        {items.slice(0, 4).map((it) => (
          <li
            key={it.id}
            className="flex items-start justify-between gap-3 bg-card px-3 py-2 text-xs"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">{it.title}</p>
              <p className="mt-0.5 truncate text-muted-foreground">
                {it.message}
              </p>
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {it.time}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default NotificationCenterFeed;
