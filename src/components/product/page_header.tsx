import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Primary page title */
  title: string;
  /** Optional short description below the title */
  description?: string;
  /** Optional eyebrow label above the title (workspace, box, scope) */
  eyebrow?: string;
  /** Toolbar actions on the right */
  actions?: ReactNode;
  /** Extra bottom content (tabs, filters) */
  below?: ReactNode;
  /** Compact spacing variant for embedded contexts */
  size?: "default" | "sm";
  className?: string;
}

/**
 * Canonical page-level header. Used at the top of every product surface to
 * establish a shared rhythm: optional eyebrow, H1 title, optional description,
 * actions slot, optional `below` slot for tabs/filters, and a hairline divider.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  below,
  size = "default",
  className,
}: PageHeaderProps) {
  const compact = size === "sm";
  return (
    <div
      className={cn(
        "border-b border-border bg-background",
        className
      )}
    >
      <div
        className={cn(
          "flex items-start justify-between gap-4",
          compact ? "px-5 pt-4 pb-3" : "px-6 pt-6 pb-5 md:px-8 md:pt-7"
        )}
      >
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="mb-1.5 text-overline text-muted-foreground">
              {eyebrow}
            </p>
          )}
          <h1
            className={cn(
              "truncate text-foreground",
              compact
                ? "text-lg font-semibold tracking-tight"
                : "text-2xl font-semibold tracking-tight"
            )}
          >
            {title}
          </h1>
          {description && (
            <p
              className={cn(
                "mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground",
                compact && "mt-1 text-[13px]"
              )}
            >
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {below && (
        <div className={cn(compact ? "px-5" : "px-6 md:px-8")}>{below}</div>
      )}
    </div>
  );
}
