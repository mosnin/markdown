import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Icon component (e.g. from lucide-react) */
  icon?: ReactNode;
  /** Short headline */
  title: string;
  /** Explanatory sentence */
  description?: string;
  /** Primary action button or link */
  action?: ReactNode;
  className?: string;
}

/**
 * Generic empty state used when a list or view has no content yet.
 * Keeps messaging focused — no decorative illustrations.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className
      )}
    >
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="max-w-xs space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
