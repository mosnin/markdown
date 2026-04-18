"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { getUnreadCountAction } from "@/app/app/activity/actions";

/**
 * Activity bell icon with unread badge.
 *
 * Polls the server for the unread count on mount and every 60 seconds.
 * Clicking navigates to /app/activity which marks everything as read.
 */
export function ActivityBell() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    const result = await getUnreadCountAction();
    if (result.ok) {
      setCount(result.data);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <Link
      href="/app/activity"
      className="relative inline-flex items-center justify-center rounded p-1 text-foreground/60 hover:text-foreground transition-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={
        count > 0 ? `Activity feed, ${count} unread` : "Activity feed"
      }
    >
      <Bell className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
