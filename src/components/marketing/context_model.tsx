import { Boxes, Folder, FileText, BookOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import { Reveal } from "@/components/marketing/reveal";

// ─── Context-model diagram ───────────────────────────────────────────────────
//
// The shape of your context: a workspace holds boxes, boxes hold folders and
// notes, and one note per box is the "guide" agents read first. A quiet,
// theme-aware hierarchy — no brand logos, just structure.

type Row = {
  icon: typeof Boxes;
  label: string;
  meta?: string;
  depth: 0 | 1 | 2;
  tone?: "default" | "guide";
};

const ROWS: Row[] = [
  { icon: Boxes, label: "Workspace", meta: "your team", depth: 0 },
  { icon: Boxes, label: "Engineering", meta: "box", depth: 1, tone: "default" },
  { icon: BookOpen, label: "Guide note", meta: "read first by agents", depth: 2, tone: "guide" },
  { icon: Folder, label: "Architecture", meta: "folder", depth: 2 },
  { icon: FileText, label: "API design", depth: 2 },
  { icon: FileText, label: "Rate limits", depth: 2 },
  { icon: Boxes, label: "Support", meta: "box", depth: 1 },
  { icon: Folder, label: "Runbooks", meta: "folder", depth: 2 },
  { icon: FileText, label: "Incident response", depth: 2 },
];

const INDENT: Record<Row["depth"], string> = {
  0: "ml-0",
  1: "ml-6",
  2: "ml-12",
};

export function ContextModel({ className }: { className?: string }) {
  return (
    <Reveal
      className={cn(
        "relative overflow-hidden rounded-3xl border border-border/60 bg-muted/20 p-5 sm:p-8",
        className,
      )}
    >
      <div className="mx-auto flex max-w-xl flex-col gap-1.5">
        {ROWS.map((row, i) => {
          const Icon = row.icon;
          const isGuide = row.tone === "guide";
          return (
            <div
              key={`${row.label}-${i}`}
              className={cn("relative flex items-center", INDENT[row.depth])}
            >
              {/* connector rail for nested rows */}
              {row.depth > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -left-3 top-1/2 h-px w-3 bg-border"
                />
              )}
              <div
                className={cn(
                  "flex flex-1 items-center gap-2.5 rounded-xl border px-3 py-2.5",
                  isGuide
                    ? "border-amber-400/50 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-900/10"
                    : row.depth === 0
                      ? "border-violet-500/30 bg-violet-500/[0.05]"
                      : "border-border/50 bg-background/50",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg",
                    isGuide
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-500"
                      : row.depth === 0
                        ? "bg-violet-600 text-white"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span
                  className={cn(
                    "text-sm font-medium",
                    isGuide ? "text-amber-700 dark:text-amber-400" : "text-foreground/85",
                  )}
                >
                  {row.label}
                </span>
                {row.meta && (
                  <span className="ml-auto text-[11px] text-muted-foreground/60">
                    {row.meta}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Reveal>
  );
}
