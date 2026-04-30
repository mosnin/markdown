"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { getUnreadCountAction } from "@/app/app/activity/actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Activity bell icon-button with an unread dot indicator.
 *
 * Polls the server for the unread count on mount and every 60 seconds.
 * Clicking navigates to /app/activity which marks everything as read.
 *
 * Visual: a quiet ghost icon-sm button matching the topbar toolbar
 * (theme toggle, operator trigger). Unread state is communicated as a
 * single brand-yellow dot in the upper-right rather than a numeric badge,
 * keeping the chrome calm. The aria-label still reports the count.
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
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon-sm" }),
        "relative text-muted-foreground hover:text-foreground"
      )}
      aria-label={
        count > 0 ? `Activity feed, ${count} unread` : "Activity feed"
      }
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      {count > 0 && (
        <span
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand ring-2 ring-background"
          aria-hidden="true"
        />
      )}
    </Link>
  );
}
