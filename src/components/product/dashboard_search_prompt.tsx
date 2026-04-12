"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatedGlowingSearchBar } from "@/components/ui/animated-glowing-search-bar";

/**
 * Dashboard prompt — the glowing search bar wired to navigate to the
 * full-text search page on Enter. Used on the dashboard home to give
 * every user a prominent jumping-off point without duplicating search
 * logic across pages.
 */
export function DashboardSearchPrompt() {
  const router = useRouter();
  const [value, setValue] = React.useState("");

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const q = value.trim();
      if (q) {
        router.push(`/app/search?q=${encodeURIComponent(q)}`);
      } else {
        router.push("/app/search");
      }
    }
  }

  return (
    <AnimatedGlowingSearchBar
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Ask, search, or jump to anything…"
      aria-label="Search notes and boxes"
    />
  );
}
