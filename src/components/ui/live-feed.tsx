"use client";
import { motion } from "motion/react";
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

export const NotificationCenterFeed = ({
  cardTitle = "Organized in real time",
  cardDescription = "Every note, link, and move tracked live.",
  feed = defaultFeed,
}: NotificationFeedProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [items, setItems] = useState(feed);
  // Compute the clock label after mount so the SSR HTML hydrates
  // identically on every client regardless of the server-vs-client
  // wall-clock skew. Inlining `new Date()` in the JSX used to produce
  // different HH:MM values between the two passes and triggered a
  // React hydration warning.
  const [clockLabel, setClockLabel] = useState("");
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Refresh once on mount, then every minute so the clock keeps
    // feeling "live". `en-GB` + hour12=false pins the output format
    // across operating systems.
    const refreshClock = () => {
      setClockLabel(
        new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
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
    <motion.div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "relative",
        "flex max-w-[350px] items-center justify-center",
        "rounded-xl border border-border/50 bg-card p-6",
      )}
    >
      <div className="relative h-[230px] w-[264px] overflow-hidden rounded-[14px] bg-muted/40 p-2">
        <div className="absolute left-3 top-2 text-[9px] text-muted-foreground">
          {clockLabel}
        </div>
        <div className="absolute inset-x-2 bottom-2 top-8">
          {items.map((it, i) => (
            <motion.div
              key={it.id + i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: i * 0.05 }}
              className="mb-2 rounded-md border border-border/60 bg-card p-2 text-xs shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                  <span className="truncate">{it.title}</span>
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{it.time}</span>
              </div>
              <div className="mt-1 truncate pl-3 text-muted-foreground">{it.message}</div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Fade-out overlay — uses card color so it works in both modes */}
      <div className="pointer-events-none absolute bottom-0 left-0 h-[160px] w-full rounded-b-xl bg-gradient-to-t from-card to-transparent" />

      <div className="absolute bottom-4 left-0 w-full px-6">
        <h3 className="text-sm font-semibold text-foreground">{cardTitle}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{cardDescription}</p>
      </div>
    </motion.div>
  );
};

export default NotificationCenterFeed;
