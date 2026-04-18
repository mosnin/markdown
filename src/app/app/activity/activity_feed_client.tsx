"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { getActivityFeedAction } from "./actions";
import { type FeedItem } from "@/server/services/activity_feed_service";

// ─── Event-type to human-readable verb mapping ─────────────────────────────

const EVENT_VERBS: Record<string, string> = {
  "note.created": "created",
  "note.updated": "updated",
  "note_link.created": "linked",
  "branch.promoted": "promoted branch",
  "member.joined": "joined the workspace",
  "write_proposal.created": "submitted a proposal for",
};

function eventVerb(eventType: string): string {
  return EVENT_VERBS[eventType] ?? eventType.replace(".", " ");
}

// ─── Relative time ──────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── Feed item row ──────────────────────────────────────────────────────────

function FeedItemRow({ item }: { item: FeedItem }) {
  const initials = (item.actor_display_name ?? "??")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-start gap-3 px-6 py-3 hover:bg-muted/30 transition-colors">
      {/* Avatar */}
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
        aria-hidden="true"
      >
        {initials}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <p className="text-sm text-foreground leading-snug">
          <span className="font-medium">{item.actor_display_name}</span>{" "}
          {eventVerb(item.event_type)}{" "}
          {item.object_display_name !== item.object_id && (
            <span className="font-medium">
              &lsquo;{item.object_display_name}&rsquo;
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {relativeTime(item.created_at)}
        </p>
      </div>
    </div>
  );
}

// ─── Feed list with infinite scroll ─────────────────────────────────────────

export function ActivityFeedClient({
  initialItems,
  initialHasMore,
}: {
  initialItems: FeedItem[];
  initialHasMore: boolean;
}) {
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    const lastItem = items[items.length - 1];
    const result = await getActivityFeedAction(lastItem?.created_at);
    if (result.ok) {
      setItems((prev) => [...prev, ...result.data.items]);
      setHasMore(result.data.has_more);
    }
    setLoading(false);
  }, [loading, hasMore, items]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <p className="text-sm text-muted-foreground">No activity yet.</p>
        <p className="text-xs text-muted-foreground">
          Events from other workspace members will appear here.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="divide-y divide-border/40">
        {items.map((item) => (
          <FeedItemRow key={item.id} item={item} />
        ))}
      </div>

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="h-px" />

      {loading && (
        <div className="flex justify-center py-4">
          <p className="text-xs text-muted-foreground">Loading more...</p>
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <div className="flex justify-center py-4">
          <p className="text-xs text-muted-foreground">
            You&apos;re all caught up.
          </p>
        </div>
      )}
    </ScrollArea>
  );
}
