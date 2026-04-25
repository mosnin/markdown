"use client";

import { useMemo } from "react";
import { List } from "lucide-react";
import { cn } from "@/lib/utils";

interface TocEntry {
  level: 2 | 3 | 4;
  text: string;
  index: number;
}

interface NoteTocPanelProps {
  markdownContent: string;
  editorScrollSelector?: string;
}

export function NoteTocPanel({
  markdownContent,
  editorScrollSelector,
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

  function scrollToHeader(entry: TocEntry) {
    const container =
      (editorScrollSelector
        ? document.querySelector(editorScrollSelector)
        : null) ?? document.querySelector(".cm-content");

    if (!container) return;

    const lines = Array.from(container.querySelectorAll(".cm-line"));
    let matchCount = 0;
    for (const line of lines) {
      const text = line.textContent ?? "";
      const hashes = "#".repeat(entry.level);
      if (text.startsWith(`${hashes} `) && text.includes(entry.text)) {
        if (matchCount === entry.index) {
          line.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        matchCount++;
      }
    }

    let fallbackCount = 0;
    for (const line of lines) {
      const text = line.textContent ?? "";
      if (/^#{2,4}\s/.test(text)) {
        if (fallbackCount === entry.index) {
          line.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        fallbackCount++;
      }
    }
  }

  const indentClass: Record<2 | 3 | 4, string> = {
    2: "pl-0 text-xs font-medium text-foreground/80",
    3: "pl-3 text-xs text-muted-foreground",
    4: "pl-6 text-[11px] text-muted-foreground/70",
  };

  return (
    <div className="flex flex-col gap-1 px-4 py-2">
      <div className="flex items-center gap-1.5 pb-1">
        <List className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Outline
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 italic">No headers found</p>
      ) : (
        <ul className="list-none flex flex-col gap-0.5">
          {entries.map((entry, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => scrollToHeader(entry)}
                title={entry.text}
                className={cn(
                  "w-full truncate rounded px-1 py-0.5 text-left transition-colors",
                  "hover:bg-accent/60 hover:text-foreground",
                  indentClass[entry.level]
                )}
              >
                {entry.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
