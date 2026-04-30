import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Icon component (e.g. from lucide-react) — rendered at 24px, muted. */
  icon?: ReactNode;
  /** Short headline */
  title: string;
  /** Explanatory sentence */
  description?: string;
  /** Primary action button or link */
  action?: ReactNode;
  /** Compact variant for embedded contexts (sidebars, inline panels). */
  size?: "default" | "sm";
  className?: string;
}

/**
 * Canonical empty state. One muted icon, one title, optional description,
 * one primary action. No decorative illustrations, no chrome tile around
 * the icon — quiet enough to disappear once content arrives.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "default",
  className,
}: EmptyStateProps) {
  const compact = size === "sm";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-16",
        className
      )}
    >
      {icon && (
        <div
          className={cn(
            "flex shrink-0 items-center justify-center text-muted-foreground/70",
            "[&>svg]:size-6"
          )}
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <div className={cn("space-y-1", compact ? "max-w-xs" : "max-w-sm")}>
        <p
          className={cn(
            "font-medium text-foreground",
            compact ? "text-sm" : "text-base"
          )}
        >
          {title}
        </p>
        {description && (
          <p
            className={cn(
              "leading-relaxed text-muted-foreground",
              compact ? "text-xs" : "text-sm"
            )}
          >
            {description}
          </p>
        )}
      </div>
      {action && <div className={compact ? "mt-1" : "mt-2"}>{action}</div>}
    </div>
  );
}
