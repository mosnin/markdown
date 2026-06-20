"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Sparkles, X } from "lucide-react";

import { cn } from "@/lib/utils";

// ─── Announcement bar ────────────────────────────────────────────────────────
//
// A slim, animated bar above the nav. A violet gradient with a sheen that
// sweeps across it, a message, and a CTA. Dismissible — the choice is
// remembered in localStorage, so it shows once until something changes. Scrolls
// away with the page (the sticky header pins to the top beneath it). The sheen
// is pure CSS and respects reduced-motion via the motion-reduce variant.

const STORAGE_KEY = "poggle.announce.dismissed.v1";

export function AnnouncementBar({
  href = "/how-it-works",
  className,
}: {
  href?: string;
  className?: string;
}) {
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") {
        setDismissed(true);
      }
    } catch {
      // ignore storage failures — bar simply stays visible
    }
  }, []);

  const dismiss = React.useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
  }, []);

  if (dismissed) return null;

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden bg-gradient-to-r from-violet-700 via-violet-600 to-fuchsia-600 text-white",
        className,
      )}
    >
      {/* Sweeping sheen */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-[announce-sheen_5s_ease-in-out_infinite] motion-reduce:hidden"
      />

      <div className="relative mx-auto flex max-w-6xl items-center justify-center gap-3 px-10 py-2 text-center sm:px-6">
        <Link
          href={href}
          className="group flex items-center gap-2 text-[13px] font-medium tracking-tight"
        >
          <Sparkles className="size-3.5 shrink-0 text-white/80" aria-hidden="true" />
          <span>
            New — connect Claude, Cursor, or any MCP agent in 60 seconds
          </span>
          <span className="hidden items-center gap-1 font-semibold underline-offset-4 group-hover:underline sm:inline-flex">
            See how
            <ArrowRight
              className="size-3.5 -translate-x-0.5 transition-transform duration-150 ease-out group-hover:translate-x-0"
              aria-hidden="true"
            />
          </span>
        </Link>
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
