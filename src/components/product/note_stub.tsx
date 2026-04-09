"use client";

import { BookOpen, Clock, FileText, Package, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type NoteKind = "note" | "guide" | "bundle";

interface NoteStubProps {
  title: string;
  kind?: NoteKind;
  /** Brief excerpt — first sentence of content */
  excerpt?: string;
  /** e.g. "2 days ago" */
  updatedAt?: string;
  tags?: string[];
  className?: string;
  onClick?: () => void;
}

const kindIcon: Record<NoteKind, React.ReactNode> = {
  note: <FileText className="h-3.5 w-3.5" />,
  guide: <BookOpen className="h-3.5 w-3.5" />,
  bundle: <Package className="h-3.5 w-3.5" />,
};

const kindLabel: Record<NoteKind, string> = {
  note: "Note",
  guide: "Guide",
  bundle: "Bundle",
};

/**
 * Card-style row for a note, guide note, or context bundle in a list.
 * Designed for the box content view and search results.
 * No markdown rendering yet — excerpt is plain text.
 */
export function NoteStub({
  title,
  kind = "note",
  excerpt,
  updatedAt,
  tags = [],
  className,
  onClick,
}: NoteStubProps) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick?.()}
      className={cn(
        "group flex flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3.5",
        "transition-standard",
        onClick && "cursor-pointer hover:border-border-strong hover:shadow-sm",
        className
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-muted-foreground">
            {kindIcon[kind]}
          </span>
          <span className="truncate text-sm font-medium text-foreground">
            {title}
          </span>
        </div>
        <Badge variant="secondary" className="shrink-0 text-xs font-normal">
          {kindLabel[kind]}
        </Badge>
      </div>

      {/* Excerpt */}
      {excerpt && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{excerpt}</p>
      )}

      {/* Footer */}
      <div className="flex items-center gap-3">
        {updatedAt && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground/70">
            <Clock className="h-3 w-3" />
            <span>{updatedAt}</span>
          </div>
        )}
        {tags.length > 0 && (
          <div className="flex items-center gap-1">
            <Tag className="h-3 w-3 text-muted-foreground/60" />
            <div className="flex gap-1">
              {tags.slice(0, 3).map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="h-4 px-1.5 text-[10px] font-normal"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Loading skeleton for NoteStub — used during data fetching.
 */
export function NoteStubSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}
