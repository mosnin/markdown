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
  const timerRef = useRef<NodeJS.Timeout | null>(null);

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
        "flex max-w-[430px] items-center justify-center",
        "rounded-2xl border border-border/50 bg-card px-7 py-8",
      )}
    >
      <div className="relative h-[272px] w-[318px] overflow-hidden rounded-[16px] bg-muted/40 p-3">
        <div className="absolute left-4 top-3 text-[10px] text-muted-foreground">
          {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
        </div>
        <div className="absolute inset-x-3 bottom-3 top-10">
          {items.map((it, i) => (
            <motion.div
              key={it.id + i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: i * 0.05 }}
              className="mb-3 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-xs shadow-sm"
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
      <div className="pointer-events-none absolute bottom-0 left-0 h-[180px] w-full rounded-b-2xl bg-gradient-to-t from-card to-transparent" />

      <div className="absolute bottom-5 left-0 w-full px-7">
        <h3 className="text-base font-semibold text-foreground">{cardTitle}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{cardDescription}</p>
      </div>
    </motion.div>
  );
};

export default NotificationCenterFeed;
