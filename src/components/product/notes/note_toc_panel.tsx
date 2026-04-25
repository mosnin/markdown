"use client";

import { useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";

interface TocEntry {
  level: 2 | 3 | 4;
  text: string;
  index: number;
}

interface NoteTocPanelProps {
  markdownContent: string;
  /** Optional CSS selector for the scroll container (defaults to `.cm-scroller`). */
  editorScrollSelector?: string;
}

/**
 * Table of Contents panel that parses `##`, `###`, and `####` headings from
 * markdown content and renders a clickable outline.
 *
 * Clicking a heading scrolls the corresponding CodeMirror line into view by
 * querying `.cm-content .cm-line` elements.
 */
export function NoteTocPanel({
  markdownContent,
  editorScrollSelector = ".cm-scroller",
}: NoteTocPanelProps) {
  const entries = useMemo<TocEntry[]>(() => {
    const lines = markdownContent.split("\n");
    const result: TocEntry[] = [];
    let index = 0;
    for (const line of lines) {
      const m = line.match(/^(#{2,4})\s+(.+)/);
      if (m) {
        const hashes = m[1].length;
        const level = Math.min(hashes, 4) as 2 | 3 | 4;
        result.push({ level, text: m[2].trim(), index });
        index++;
      }
    }
    return result;
  }, [markdownContent]);

  const handleClick = useCallback(
    (entry: TocEntry) => {
      // Find the nth heading line inside .cm-content
      const cmContent = document.querySelector(".cm-content");
      if (!cmContent) return;

      // Walk all cm-line elements and find the nth matching heading
      const allLines = cmContent.querySelectorAll(".cm-line");
      let headingCount = 0;
      for (const lineEl of allLines) {
        const text = lineEl.textContent ?? "";
        if (/^#{2,4}\s/.test(text)) {
          if (headingCount === entry.index) {
            lineEl.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
          }
          headingCount++;
        }
      }

      // Fallback: scroll the scroller container
      const scroller = document.querySelector(editorScrollSelector);
      if (scroller) {
        scroller.scrollTop = 0;
      }
    },
    [editorScrollSelector]
  );

  if (entries.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        No headers found. Use{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-[11px]">##</code>{" "}
        to add section headings.
      </div>
    );
  }

  return (
    <nav aria-label="Table of contents" className="flex flex-col gap-0.5 px-2 py-2">
      {entries.map((entry) => (
        <button
          key={`${entry.index}:${entry.text}`}
          type="button"
          onClick={() => handleClick(entry)}
          className={cn(
            "truncate rounded px-2 py-1 text-left text-xs text-muted-foreground",
            "transition-colors hover:bg-accent hover:text-foreground",
            entry.level === 2 && "pl-2 font-medium text-foreground/80",
            entry.level === 3 && "pl-5",
            entry.level === 4 && "pl-8"
          )}
          title={entry.text}
        >
          {entry.text}
        </button>
      ))}
    </nav>
  );
}
