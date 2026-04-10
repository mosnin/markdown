import { type ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Primary page title */
  title: string;
  /** Optional short description below the title */
  description?: string;
  /** Optional eyebrow label above the title (e.g. workspace or box name) */
  eyebrow?: string;
  /** Toolbar actions on the right */
  actions?: ReactNode;
  /** Extra bottom content (tabs, filters) */
  below?: ReactNode;
  className?: string;
}

/**
 * Consistent page-level header used at the top of each main content area.
 * Provides title, optional description, and action slot.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  below,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("bg-background", className)}>
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {eyebrow}
            </p>
          )}
          <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {below && <div className="px-6 pb-0">{below}</div>}
      <Separator />
    </div>
  );
}
